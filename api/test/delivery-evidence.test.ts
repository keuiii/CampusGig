import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { deliveryRequestFingerprint } from "../src/modules/orders/delivery-evidence";
import { OrdersService } from "../src/modules/orders/orders.service";

test("delivery idempotency fingerprints authoritative file evidence", () => {
  const evidence = {
    storagePath: "private-object-a.pdf",
    originalName: "final.pdf",
    mimeType: "application/pdf",
    sizeBytes: 128,
    checksum: "a".repeat(64),
  };
  const first = deliveryRequestFingerprint(" Final work ", [evidence]);
  assert.equal(
    first,
    deliveryRequestFingerprint("Final work", [
      { ...evidence, storagePath: "retry-object.pdf" },
    ]),
  );
  assert.notEqual(
    first,
    deliveryRequestFingerprint("Final work", [
      { ...evidence, checksum: "b".repeat(64) },
    ]),
  );
});

test("authorized evidence access creates append-only grants without workflow side effects", async () => {
  const audits: any[] = [];
  const order = {
    id: "order-1",
    clientId: "client-1",
    providerId: "provider-1",
    status: "SUBMITTED",
  };
  const payment = { id: "payment-1", status: "PAID" };
  const file = {
    id: "file-1",
    orderId: order.id,
    deliverySubmissionId: "submission-2",
    storagePath: "delivery.pdf",
    originalName: "delivery.pdf",
    mimeType: "application/pdf",
  };
  const prisma = {
    order: {
      findFirst: async ({ where }: any) =>
        where.id === order.id &&
        where.OR?.some(
          (candidate: any) =>
            candidate.clientId === order.clientId ||
            candidate.providerId === order.providerId,
        )
          ? order
          : null,
    },
    payment: { findFirst: async () => payment },
    orderFile: {
      findFirst: async ({ where, select }: any) => {
        if (where.id !== file.id || where.orderId !== order.id) return null;
        if (where.deliverySubmissionId !== undefined)
          return {
            deliverySubmission: { orderId: order.id },
          };
        return Object.fromEntries(
          Object.keys(select).map((key) => [key, (file as any)[key]]),
        );
      },
    },
    deliveryFileAccessAudit: {
      create: async ({ data }: any) => {
        const created = { id: `audit-${audits.length + 1}`, ...data };
        audits.push(created);
        return created;
      },
    },
  };
  const service = new OrdersService(
    prisma as never,
    undefined as never,
    undefined as never,
  );

  for (const userId of [order.clientId, order.providerId]) {
    const authorized = await service.getFile(userId, order.id, file.id);
    await service.recordDeliveryFileAccess({
      orderId: order.id,
      deliverySubmissionId: authorized.deliverySubmissionId!,
      fileId: file.id,
      userId,
    });
  }
  await service.recordDeliveryFileAccess({
    orderId: order.id,
    deliverySubmissionId: file.deliverySubmissionId,
    fileId: file.id,
    userId: order.clientId,
  });

  assert.deepEqual(
    audits.map(
      ({ orderId, deliverySubmissionId, fileId, userId, accessType }) => ({
        orderId,
        deliverySubmissionId,
        fileId,
        userId,
        accessType,
      }),
    ),
    [
      {
        orderId: order.id,
        deliverySubmissionId: file.deliverySubmissionId,
        fileId: file.id,
        userId: order.clientId,
        accessType: "ACCESS_GRANTED",
      },
      {
        orderId: order.id,
        deliverySubmissionId: file.deliverySubmissionId,
        fileId: file.id,
        userId: order.providerId,
        accessType: "ACCESS_GRANTED",
      },
      {
        orderId: order.id,
        deliverySubmissionId: file.deliverySubmissionId,
        fileId: file.id,
        userId: order.clientId,
        accessType: "ACCESS_GRANTED",
      },
    ],
  );
  assert.equal(order.status, "SUBMITTED");
  assert.equal(payment.status, "PAID");
  await assert.rejects(
    service.getFile("unrelated-user", order.id, file.id),
    NotFoundException,
  );
  assert.equal(audits.length, 3);
});

test("simultaneous submissions serialize to one immutable version and retries are idempotent", async () => {
  const order: any = {
    id: "order-1",
    orderNumber: "CG-D-1",
    clientId: "client-1",
    providerId: "provider-1",
    titleSnapshot: "Evidence package",
    status: "IN_PROGRESS",
    requirements: "Provide the final files",
    subtotalCentavos: 10000,
    platformFeeCentavos: 500,
    totalCentavos: 10500,
    currency: "PHP",
    createdAt: new Date(),
    revisionsUsed: 0,
    revisionLimit: 1,
    client: { id: "client-1", displayName: "Client" },
    provider: { id: "provider-1", displayName: "Provider" },
    servicePackage: null,
    files: [],
    deliverySubmissions: [],
    revisions: [],
    disputes: [],
    review: null,
    payments: [{ id: "payment-1", status: "PAID", paidAt: new Date() }],
  };
  const notifications: any[] = [];
  const deleted: string[] = [];
  let storedCount = 0;
  let waitingUploads = 0;
  let releaseUploads!: () => void;
  const uploadsReady = new Promise<void>((resolveReady) => {
    releaseUploads = resolveReady;
  });
  let transactionTail = Promise.resolve();
  const database: any = {
    $queryRaw: async () => [{ locked: true }],
    order: {
      findFirst: async () => order,
      updateMany: async ({ where, data }: any) => {
        if (order.status !== where.status) return { count: 0 };
        order.status = data.status;
        order.submittedAt = data.submittedAt;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => order,
    },
    deliverySubmission: {
      findUnique: async ({ where }: any) =>
        order.deliverySubmissions.find(
          (submission: any) =>
            submission.clientRequestId ===
            where.orderId_clientRequestId.clientRequestId,
        ) ?? null,
      findFirst: async () => order.deliverySubmissions[0] ?? null,
      create: async ({ data }: any) => {
        const submission = {
          id: `submission-${data.version}`,
          ...data,
          files: [],
        };
        order.deliverySubmissions.unshift(submission);
        return submission;
      },
    },
    orderFile: {
      createMany: async ({ data }: any) => {
        order.files.push(...data);
        order.deliverySubmissions[0].files.push(...data);
      },
    },
    revisionRequest: { updateMany: async () => ({ count: 0 }) },
    orderStatusHistory: { create: async () => undefined },
    notification: {
      create: async ({ data }: any) => notifications.push(data),
    },
  };
  const prisma: any = {
    order: {
      findFirst: async ({ where }: any) =>
        where.providerId === order.providerId ? order : null,
    },
    payment: { findFirst: async () => ({ id: "payment-1" }) },
    deliverySubmission: database.deliverySubmission,
    $transaction: async (operation: (client: any) => Promise<unknown>) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolveTransaction) => {
        release = resolveTransaction;
      });
      await previous;
      try {
        return await operation(database);
      } finally {
        release();
      }
    },
  };
  const storage = {
    persistEvidenceUploads: async () => {
      waitingUploads += 1;
      if (waitingUploads === 2) releaseUploads();
      await uploadsReady;
      storedCount += 1;
      return [
        {
          storagePath: `stored-${storedCount}.pdf`,
          checksum: "a".repeat(64),
        },
      ];
    },
    delete: async (_namespace: string, key: string) => deleted.push(key),
  };
  const service = new OrdersService(
    prisma,
    undefined as never,
    storage as never,
  );
  const file = {
    originalname: "final.pdf",
    mimetype: "application/pdf",
    size: 512,
  } as Express.Multer.File;

  const simultaneous = await Promise.allSettled([
    service.deliver(
      order.providerId,
      order.id,
      "Final evidence",
      [file],
      "00000000-0000-4000-8000-000000000001",
    ),
    service.deliver(
      order.providerId,
      order.id,
      "Competing evidence",
      [file],
      "00000000-0000-4000-8000-000000000002",
    ),
  ]);
  assert.equal(
    simultaneous.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    simultaneous.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.ok(
    simultaneous.some(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof ConflictException,
    ),
  );
  assert.equal(order.deliverySubmissions.length, 1);
  assert.equal(order.deliverySubmissions[0].version, 1);
  assert.equal(order.deliverySubmissions[0].files.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(deleted.length, 1);

  const committedRequestId = order.deliverySubmissions[0].clientRequestId;
  const retry = await service.deliver(
    order.providerId,
    order.id,
    order.deliverySubmissions[0].note,
    [file],
    committedRequestId,
  );
  assert.match(retry.message, /already received/);
  assert.equal(order.deliverySubmissions.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(deleted.length, 2);
});

test("Phase D schema, migration, API, and clients preserve the evidence boundary", () => {
  const root = resolve(import.meta.dirname, "../..");
  const schema = readFileSync(
    resolve(root, "api/prisma/schema.prisma"),
    "utf8",
  );
  const migration = readFileSync(
    resolve(
      root,
      "api/prisma/migrations/20261005130000_add_immutable_delivery_evidence/migration.sql",
    ),
    "utf8",
  );
  const controller = readFileSync(
    resolve(root, "api/src/modules/orders/orders.controller.ts"),
    "utf8",
  );
  const service = readFileSync(
    resolve(root, "api/src/modules/orders/orders.service.ts"),
    "utf8",
  );
  const web = readFileSync(
    resolve(root, "app/features/orders/WebOrderWorkspace.tsx"),
    "utf8",
  );
  const mobile = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/Pages/OrderWorkspacePage.xaml"),
    "utf8",
  );

  assert.match(
    schema,
    /model DeliverySubmission[\s\S]*@@unique\(\[orderId, version\]\)/,
  );
  assert.match(schema, /model DeliveryFileAccessAudit/);
  assert.match(schema, /deliverySubmissionId\s+String\?/);
  assert.match(migration, /ROW_NUMBER\(\) OVER/);
  assert.match(migration, /history\."createdAt" >= file\."createdAt"/);
  assert.match(
    migration,
    /"checksum" IS NULL OR "checksum" ~ '\^\[0-9a-f\]\{64\}\$'/,
  );
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|TYPE)/i);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /accessType: "ACCESS_GRANTED"/);
  assert.match(controller, /storage\.delivery[\s\S]*recordDeliveryFileAccess/);
  assert.match(
    web,
    /Downloading a file does not automatically accept the order\./,
  );
  assert.match(
    mobile,
    /Downloading a file does not automatically accept the order\./,
  );
  assert.doesNotMatch(migration, /ProviderEarning|payout|auto.?complet/i);
});
