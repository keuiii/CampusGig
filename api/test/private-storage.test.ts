import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import multer, { diskStorage } from "multer";
import { MalwareScannerService } from "../src/common/storage/malware-scanner.service";
import {
  parseClamAvResponse,
  type MalwareScanResult,
} from "../src/common/storage/malware-scanner.types";
import { StorageService } from "../src/common/storage/storage.service";
import { assertUploadSignature } from "../src/common/storage/file-signature";
import {
  contentDisposition,
  safeStorageKey,
} from "../src/common/storage/storage.types";

function config(values: Record<string, string>) {
  return { get: (key: string) => values[key] } as never;
}

function storage(
  values: Record<string, string>,
  scan: (path: string) => Promise<MalwareScanResult> = async () => ({
    status: "clean",
  }),
) {
  return new StorageService(config(values), { scan } as never);
}

async function waitForFileCount(directory: string, expectedCount: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await readdir(directory)).length === expectedCount) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.fail(`Expected ${expectedCount} staged file(s) in ${directory}`);
}

test("storage keys cannot escape their assigned private namespace", () => {
  assert.equal(safeStorageKey("asset-1.pdf"), "asset-1.pdf");
  assert.throws(() => safeStorageKey("../asset-1.pdf"), /Invalid storage key/);
  assert.throws(
    () => safeStorageKey("folder/asset-1.pdf"),
    /Invalid storage key/,
  );
  assert.throws(
    () => safeStorageKey("folder\\asset-1.pdf"),
    /Invalid storage key/,
  );
});

test("download names cannot inject response headers", () => {
  const value = contentDisposition('proof"\r\nX-Unsafe: yes.pdf');
  assert.doesNotMatch(value, /\r|\n/);
  assert.match(value, /^attachment; filename=/);
  assert.match(value, /filename\*=UTF-8''/);
});

test("production refuses local private-file storage", () => {
  assert.throws(
    () => storage({ NODE_ENV: "production", STORAGE_DRIVER: "local" }),
    /Production requires STORAGE_DRIVER=s3/,
  );
  assert.throws(
    () => storage({ STORAGE_DRIVER: "s3", S3_REGION: "ap-southeast-1" }),
    /S3_BUCKET is required/,
  );
  assert.doesNotThrow(() => storage({ STORAGE_DRIVER: "local" }));
});

test("production requires ClamAV and validates its connection settings", () => {
  assert.throws(
    () =>
      new MalwareScannerService(
        config({ NODE_ENV: "production", MALWARE_SCANNER_DRIVER: "disabled" }),
      ),
    /Production requires MALWARE_SCANNER_DRIVER=clamav/,
  );
  assert.throws(
    () =>
      new MalwareScannerService(
        config({ MALWARE_SCANNER_DRIVER: "clamav", CLAMAV_PORT: "70000" }),
      ),
    /CLAMAV_PORT must be between 1 and 65535/,
  );
});

test("ClamAV responses distinguish clean files, infections, and invalid replies", () => {
  assert.deepEqual(parseClamAvResponse("stream: OK\0"), { status: "clean" });
  assert.deepEqual(parseClamAvResponse("stream: Eicar-Signature FOUND\0"), {
    status: "infected",
    signature: "Eicar-Signature",
  });
  assert.throws(
    () => parseClamAvResponse("stream: scan failed ERROR\0"),
    /Unexpected ClamAV response/,
  );
});

test("ClamAV readiness requires a valid PONG response", async () => {
  const server = createServer((socket) => {
    socket.once("data", (command) => {
      assert.equal(command.toString("utf8"), "zPING\0");
      socket.write("PONG\0");
    });
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  try {
    const address = server.address() as AddressInfo;
    const scanner = new MalwareScannerService(
      config({
        MALWARE_SCANNER_DRIVER: "clamav",
        CLAMAV_HOST: "127.0.0.1",
        CLAMAV_PORT: String(address.port),
        CLAMAV_TIMEOUT_MS: "5000",
      }),
    );
    await scanner.healthCheck();
  } finally {
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    );
  }
});

test("ClamAV scanning streams length-prefixed file bytes to the daemon", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "campusgig-clamav-"));
  const stagedPath = join(temporaryRoot, "upload.bin");
  const contents = Buffer.from("safe-content-".repeat(12_000));
  await writeFile(stagedPath, contents);
  const received: Buffer[] = [];
  const server = createServer((socket) => {
    let input = Buffer.alloc(0);
    let commandReceived = false;
    let expectedLength: number | undefined;
    socket.on("data", (chunk) => {
      input = Buffer.concat([input, chunk]);
      while (true) {
        if (!commandReceived) {
          const terminator = input.indexOf(0);
          if (terminator < 0) return;
          const command = input.subarray(0, terminator).toString("utf8");
          input = input.subarray(terminator + 1);
          if (command !== "zINSTREAM") {
            socket.write("stream: invalid command ERROR\0");
            return;
          }
          commandReceived = true;
        }
        if (expectedLength === undefined) {
          if (input.length < 4) return;
          expectedLength = input.readUInt32BE(0);
          input = input.subarray(4);
          if (expectedLength === 0) {
            socket.write("stream: OK\0");
            return;
          }
        }
        if (input.length < expectedLength) return;
        received.push(input.subarray(0, expectedLength));
        input = input.subarray(expectedLength);
        expectedLength = undefined;
      }
    });
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  try {
    const address = server.address() as AddressInfo;
    const scanner = new MalwareScannerService(
      config({
        MALWARE_SCANNER_DRIVER: "clamav",
        CLAMAV_HOST: "127.0.0.1",
        CLAMAV_PORT: String(address.port),
        CLAMAV_TIMEOUT_MS: "5000",
      }),
    );
    assert.deepEqual(await scanner.scan(stagedPath), { status: "clean" });
    assert.deepEqual(Buffer.concat(received), contents);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    );
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("every stored upload is scanned before local persistence", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "campusgig-signature-"));
  const stagedPath = join(temporaryRoot, "avatar.jpg");
  await writeFile(
    stagedPath,
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9]),
  );
  const scanned: string[] = [];
  const service = storage({ STORAGE_DRIVER: "local" }, async (path) => {
    scanned.push(path);
    return { status: "clean" };
  });
  try {
    const key = await service.persistUpload("avatars", {
      filename: "avatar.jpg",
      originalname: "avatar.jpg",
      mimetype: "image/jpeg",
      path: stagedPath,
    } as Express.Multer.File);
    assert.equal(key, "avatar.jpg");
    assert.deepEqual(scanned, [stagedPath]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("delivery evidence streams a server-generated SHA-256 after validation", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "campusgig-evidence-"));
  const stagedPath = join(temporaryRoot, "delivery.pdf");
  const contents = Buffer.from("%PDF-1.7\nimmutable delivery evidence\n%%EOF");
  await writeFile(stagedPath, contents);
  const service = storage({ STORAGE_DRIVER: "local" });
  try {
    const [evidence] = await service.persistEvidenceUploads("order-files", [
      {
        filename: "delivery.pdf",
        originalname: "Final Delivery.pdf",
        mimetype: "application/pdf",
        path: stagedPath,
      } as Express.Multer.File,
    ]);
    assert.equal(evidence.storagePath, "delivery.pdf");
    assert.equal(
      evidence.checksum,
      createHash("sha256").update(contents).digest("hex"),
    );
    assert.match(evidence.checksum, /^[0-9a-f]{64}$/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("file signatures reject renamed executable content before malware scanning", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "campusgig-mismatch-"));
  const stagedPath = join(temporaryRoot, "renamed.jpg");
  await writeFile(stagedPath, Buffer.from("MZ-not-an-image"));
  let scanned = false;
  const service = storage({ STORAGE_DRIVER: "local" }, async () => {
    scanned = true;
    return { status: "clean" };
  });
  try {
    await assert.rejects(
      () =>
        service.persistUpload("avatars", {
          filename: "renamed.jpg",
          originalname: "renamed.jpg",
          mimetype: "image/jpeg",
          path: stagedPath,
        } as Express.Multer.File),
      /does not match its declared type/,
    );
    assert.equal(scanned, false);
    await assert.rejects(() => readFile(stagedPath), { code: "ENOENT" });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("Office uploads must contain the matching OOXML package directory", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "campusgig-ooxml-"));
  const docxPath = join(temporaryRoot, "document.docx");
  const fakeXlsxPath = join(temporaryRoot, "renamed.xlsx");
  const docxBytes = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("[Content_Types].xml\0word/document.xml"),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  ]);
  await writeFile(docxPath, docxBytes);
  await writeFile(fakeXlsxPath, docxBytes);
  try {
    await assert.doesNotReject(() =>
      assertUploadSignature({
        mimetype:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        path: docxPath,
      } as Express.Multer.File),
    );
    await assert.rejects(
      () =>
        assertUploadSignature({
          mimetype:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          path: fakeXlsxPath,
        } as Express.Multer.File),
      /does not match its declared type/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("every allowed upload family has a complete matching signature", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "campusgig-file-types-"));
  const webp = Buffer.alloc(16);
  webp.write("RIFF", 0, "ascii");
  webp.writeUInt32LE(8, 4);
  webp.write("WEBP", 8, "ascii");
  const zipEnd = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const samples = [
    {
      name: "image.png",
      mime: "image/png",
      bytes: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from("IEND"),
      ]),
    },
    { name: "image.webp", mime: "image/webp", bytes: webp },
    {
      name: "document.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.7\n%%EOF"),
    },
    {
      name: "archive.zip",
      mime: "application/zip",
      bytes: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), zipEnd]),
    },
    {
      name: "sheet.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from("[Content_Types].xml\0xl/workbook.xml"),
        zipEnd,
      ]),
    },
  ];
  try {
    for (const sample of samples) {
      const path = join(temporaryRoot, sample.name);
      await writeFile(path, sample.bytes);
      await assert.doesNotReject(() =>
        assertUploadSignature({
          mimetype: sample.mime,
          path,
        } as Express.Multer.File),
      );
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("scanner failures reject the upload and remove its staging file", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "campusgig-scan-"));
  const stagedPath = join(temporaryRoot, "upload.pdf");
  await writeFile(stagedPath, "%PDF-1.7\nuntrusted upload\n%%EOF");
  try {
    const service = storage({ STORAGE_DRIVER: "local" }, async () => {
      throw new Error("scanner unavailable");
    });
    await assert.rejects(
      () =>
        service.persistUpload("order-files", {
          filename: "upload.pdf",
          originalname: "upload.pdf",
          mimetype: "application/pdf",
          path: stagedPath,
        } as Express.Multer.File),
      /scanner unavailable/,
    );
    await assert.rejects(() => readFile(stagedPath), { code: "ENOENT" });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("aborted multipart uploads remove partially written disk files", async () => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "campusgig-aborted-upload-"),
  );
  const boundary = "campusgig-aborted-upload-boundary";
  let completeMiddleware!: (error: unknown) => void;
  const middlewareFinished = new Promise<unknown>((resolveFinished) => {
    completeMiddleware = resolveFinished;
  });
  const upload = multer({
    storage: diskStorage({
      destination: temporaryRoot,
      filename: (_request, _file, callback) =>
        callback(null, "partial-upload.bin"),
    }),
    limits: { fileSize: 1024 * 1024, files: 1 },
  }).single("file");
  const server = createHttpServer((request, response) => {
    upload(request as never, response as never, (error: unknown) => {
      completeMiddleware(error);
      response.destroy();
    });
  });

  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  try {
    const address = server.address() as AddressInfo;
    const multipartHeader = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="partial.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    const declaredLength = multipartHeader.length + 512 * 1024;
    const client = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": declaredLength,
      },
    });
    client.on("error", () => undefined);
    client.write(multipartHeader);
    client.write(Buffer.alloc(64 * 1024, 0x61));

    await waitForFileCount(temporaryRoot, 1);
    client.destroy();

    const middlewareError = await Promise.race([
      middlewareFinished,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("Multer did not finish abort cleanup")),
          2_000,
        ),
      ),
    ]);
    assert.match(String(middlewareError), /aborted|closed/i);
    await waitForFileCount(temporaryRoot, 0);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    );
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("S3 delivery URLs are scoped, short-lived, and signed without network access", async () => {
  const service = storage({
    STORAGE_DRIVER: "s3",
    S3_BUCKET: "campusgig-private",
    S3_REGION: "ap-southeast-1",
    S3_PREFIX: "production",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
    STORAGE_SIGNED_URL_TTL_SECONDS: "180",
  });
  const delivery = await service.delivery("order-files", "delivery.pdf", {
    downloadName: "Final Delivery.pdf",
    contentType: "application/pdf",
  });
  assert.equal(delivery.kind, "redirect");
  if (delivery.kind !== "redirect") return;
  assert.equal(delivery.expiresInSeconds, 180);
  assert.match(
    delivery.url,
    /production%2Forder-files%2Fdelivery\.pdf|production\/order-files\/delivery\.pdf/,
  );
  assert.match(delivery.url, /X-Amz-Expires=180/i);
  assert.match(delivery.url, /X-Amz-Signature=/i);
});

test("batch persistence removes completed objects and every staging file after a partial failure", async () => {
  const service = storage({ STORAGE_DRIVER: "local" });
  const persisted: string[] = [];
  const deleted: string[] = [];
  const discarded: string[] = [];
  const mutable = service as StorageService & {
    persistUpload: (
      namespace: "order-files",
      file: Express.Multer.File,
    ) => Promise<string>;
    delete: (namespace: "order-files", key: string) => Promise<void>;
    discardUpload: (file: Express.Multer.File) => Promise<void>;
  };
  mutable.persistUpload = async (_namespace, file) => {
    if (file.filename === "second.pdf") throw new Error("upload failed");
    persisted.push(file.filename);
    return file.filename;
  };
  mutable.delete = async (_namespace, key) => {
    deleted.push(key);
  };
  mutable.discardUpload = async (file) => {
    discarded.push(file.filename);
  };
  const files = ["first.pdf", "second.pdf", "third.pdf"].map(
    (filename) => ({ filename }) as Express.Multer.File,
  );

  await assert.rejects(
    () => service.persistUploads("order-files", files),
    /upload failed/,
  );
  assert.deepEqual(persisted, ["first.pdf"]);
  assert.deepEqual(deleted, ["first.pdf"]);
  assert.deepEqual(discarded, ["first.pdf", "second.pdf", "third.pdf"]);
});

test("authorized file controllers delegate delivery to centralized storage", () => {
  const root = resolve(import.meta.dirname, "../..");
  const orderController = readFileSync(
    resolve(root, "api/src/modules/orders/orders.controller.ts"),
    "utf8",
  );
  const adminController = readFileSync(
    resolve(root, "api/src/modules/admin/admin.controller.ts"),
    "utf8",
  );
  const providerController = readFileSync(
    resolve(root, "api/src/modules/provider/provider.controller.ts"),
    "utf8",
  );
  const publicController = readFileSync(
    resolve(root, "api/src/modules/services/services.controller.ts"),
    "utf8",
  );
  assert.match(orderController, /orders\.getFile[\s\S]*storage\.delivery/);
  assert.match(
    adminController,
    /verificationsService\.getDocument[\s\S]*storage\.delivery/,
  );
  assert.match(
    providerController,
    /providers\.getOwnedMedia[\s\S]*storage\.delivery/,
  );
  assert.match(
    publicController,
    /services\.getPublicMedia[\s\S]*storage\.delivery/,
  );
  assert.doesNotMatch(
    `${orderController}${adminController}${providerController}${publicController}`,
    /private-storage|StorageRoot/,
  );
});

test("web and mobile renew expired signed downloads without exposing partial files", () => {
  const root = resolve(import.meta.dirname, "../..");
  const webApi = readFileSync(resolve(root, "app/lib/api.ts"), "utf8");
  const mobileApi = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/Services/CampusGigApi.cs"),
    "utf8",
  );

  assert.match(webApi, /response\.redirected/);
  assert.match(
    webApi,
    /response\.status === 400 \|\| response\.status === 403/,
  );
  assert.match(mobileApi, /DownloadRetryRules\.ShouldRenewSignedUrl/);
  assert.match(mobileApi, /\.part/);
  assert.match(mobileApi, /File\.Move\(partial, destination, true\)/);
  assert.match(mobileApi, /transferHttp\.SendAsync\(request/);
});
