import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { PrismaClient, hash } from "../api/test/support/e2e-dependencies";

if (!process.env.DATABASE_URL) process.loadEnvFile("api/.env");

const repoRoot = process.cwd();
const apiUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:4000/api/v1";
const webUrl = process.env.E2E_WEB_URL ?? "http://127.0.0.1:3000";
const appiumUrl = process.env.E2E_APPIUM_URL ?? "http://127.0.0.1:4723";
const avdName = process.env.E2E_ANDROID_AVD ?? "pixel_9_-_api_36_0";
const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const prisma = new PrismaClient();
const elementKey = "element-6066-11e4-a52e-4f735466cecf";

function requireLocalUrl(value: string, optInVariable: string) {
  if (
    process.env[optInVariable] !== "true" &&
    !localHosts.has(new URL(value).hostname)
  )
    throw new Error(
      `${value} must be local unless ${optInVariable}=true is explicitly set`,
    );
}

requireLocalUrl(apiUrl, "E2E_ALLOW_REMOTE");
requireLocalUrl(webUrl, "E2E_ALLOW_REMOTE");
requireLocalUrl(appiumUrl, "E2E_ALLOW_REMOTE");
if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required for the disposable Android E2E journey",
  );
requireLocalUrl(process.env.DATABASE_URL, "E2E_ALLOW_REMOTE_DATABASE");
if (!androidHome)
  throw new Error("ANDROID_HOME or ANDROID_SDK_ROOT must be configured");

const adb = path.join(
  androidHome,
  "platform-tools",
  process.platform === "win32" ? "adb.exe" : "adb",
);
const emulator = path.join(
  androidHome,
  "emulator",
  process.platform === "win32" ? "emulator.exe" : "emulator",
);
if (!existsSync(adb))
  throw new Error(`Android Debug Bridge was not found at ${adb}`);

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const reportStep = (message: string) => console.log(`[android-e2e] ${message}`);

async function run(file: string, args: string[], capture = false) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: repoRoot,
      windowsHide: true,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    if (capture) {
      child.stdout?.on("data", (chunk) => (output += chunk.toString()));
      child.stderr?.on("data", (chunk) => (output += chunk.toString()));
    }
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `${path.basename(file)} exited with code ${code}${output ? `\n${output}` : ""}`,
            ),
          ),
    );
  });
}
async function waitFor(
  check: () => Promise<boolean>,
  description: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function ensureApiIsReady() {
  await waitFor(
    async () => {
      try {
        const response = await fetch(`${apiUrl}/health`);
        return response.ok;
      } catch {
        return false;
      }
    },
    "the local CampusGig API",
    5_000,
  );
}

async function startWebIfNeeded() {
  try {
    const current = await fetch(webUrl);
    if (current.ok) return undefined;
  } catch {}

  const entrypoint = path.join(repoRoot, "scripts", "start-next-e2e.mjs");
  if (!existsSync(entrypoint))
    throw new Error("The local Next.js E2E starter is missing");
  const parsed = new URL(webUrl);
  const child = spawn(process.execPath, [entrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      E2E_WEB_HOST: parsed.hostname,
      E2E_WEB_PORT: parsed.port || "3000",
      NEXT_PUBLIC_API_URL: new URL(apiUrl).origin,
      NEXT_DIST_DIR: ".next-mobile-e2e",
    },
    windowsHide: true,
    stdio: "inherit",
  });
  try {
    await waitFor(
      async () => {
        if (child.exitCode !== null)
          throw new Error("Next.js stopped during startup");
        try {
          return (await fetch(webUrl)).ok;
        } catch {
          return false;
        }
      },
      "the local CampusGig web application",
      240_000,
    );
  } catch (error) {
    child.kill();
    throw error;
  }
  return child;
}

async function connectedDevices() {
  const output = await run(adb, ["devices"], true);
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/, 2))
    .filter((parts) => parts.length === 2 && parts[1] === "device")
    .map(([serial]) => serial);
}

async function waitForStableAdb(serial: string) {
  let consecutiveReadyChecks = 0;
  await waitFor(
    async () => {
      try {
        const output = await run(
          adb,
          ["-s", serial, "shell", "echo", "campusgig-ready"],
          true,
        );
        consecutiveReadyChecks =
          output.trim() === "campusgig-ready" ? consecutiveReadyChecks + 1 : 0;
      } catch {
        consecutiveReadyChecks = 0;
      }
      return consecutiveReadyChecks >= 3;
    },
    "stable Android Debug Bridge authorization",
    60_000,
  );
}

async function ensureEmulator() {
  let devices = await connectedDevices();
  if (!devices.length) {
    if (!existsSync(emulator))
      throw new Error(`Android emulator was not found at ${emulator}`);
    const available = (await run(emulator, ["-list-avds"], true))
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!available.includes(avdName))
      throw new Error(
        `Android AVD '${avdName}' does not exist. Available AVDs: ${available.join(", ")}`,
      );
    const child = spawn(emulator, ["-avd", avdName, "-no-snapshot-save"], {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    await waitFor(
      async () => (await connectedDevices()).length > 0,
      "the Android emulator",
      180_000,
    );
    devices = await connectedDevices();
  }
  const requested = process.env.E2E_ANDROID_DEVICE;
  if (requested && !devices.includes(requested))
    throw new Error(`Requested Android device '${requested}' is not connected`);
  if (!requested && devices.length > 1)
    throw new Error(
      "Multiple Android devices are connected; set E2E_ANDROID_DEVICE to select one explicitly",
    );
  const serial = requested ?? devices[0];
  await waitFor(
    async () => {
      const state = (
        await run(
          adb,
          ["-s", serial, "shell", "getprop", "sys.boot_completed"],
          true,
        )
      ).trim();
      return state === "1";
    },
    "Android to finish booting",
    180_000,
  );
  await waitFor(
    async () => {
      try {
        const output = await run(
          adb,
          ["-s", serial, "shell", "service", "check", "input"],
          true,
        );
        return /Service input:\s+found/i.test(output);
      } catch {
        return false;
      }
    },
    "the Android input service",
    90_000,
  );
  await run(adb, ["-s", serial, "shell", "input", "keyevent", "82"], true);
  await waitForStableAdb(serial);
  return serial;
}

function newestSignedApk(directory: string): string | undefined {
  if (!existsSync(directory)) return undefined;
  const matches: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      if (statSync(fullPath).isDirectory()) visit(fullPath);
      else if (entry.endsWith("-Signed.apk")) matches.push(fullPath);
    }
  };
  visit(directory);
  return matches.sort(
    (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs,
  )[0];
}

const androidRuntimeIdentifiers = {
  "arm64-v8a": "android-arm64",
  "armeabi-v7a": "android-arm",
  x86_64: "android-x64",
  x86: "android-x86",
} as const;

async function androidRuntimeIdentifier(serial: string) {
  const abi = (
    await run(
      adb,
      ["-s", serial, "shell", "getprop", "ro.product.cpu.abi"],
      true,
    )
  ).trim();
  const runtimeIdentifier =
    androidRuntimeIdentifiers[abi as keyof typeof androidRuntimeIdentifiers];
  if (!runtimeIdentifier)
    throw new Error(
      `Android device '${serial}' reported unsupported primary ABI '${abi || "unknown"}'`,
    );
  return runtimeIdentifier;
}

async function buildAndroidApp(serial: string) {
  const runtimeIdentifier = await androidRuntimeIdentifier(serial);
  reportStep(`building standalone APK for ${runtimeIdentifier}`);
  await run("dotnet", [
    "restore",
    "maui/CampusGig.Mobile/CampusGig.Mobile.csproj",
    "-p:TargetFramework=net10.0-android",
    "-r",
    runtimeIdentifier,
  ]);
  await run("dotnet", [
    "build",
    "maui/CampusGig.Mobile/CampusGig.Mobile.csproj",
    "-t:Rebuild",
    "-f",
    "net10.0-android",
    "-c",
    "Debug",
    "-r",
    runtimeIdentifier,
    "--no-restore",
    "-p:EmbedAssembliesIntoApk=true",
    "-p:AndroidEnableAssemblyCompression=false",
    "-p:AndroidStoreUncompressedFileExtensions=.so",
    "-p:AndroidPackageFormat=apk",
  ]);
  const apk = newestSignedApk(
    path.join(
      repoRoot,
      "maui",
      "CampusGig.Mobile",
      "bin",
      "Debug",
      "net10.0-android",
      runtimeIdentifier,
    ),
  );
  if (!apk)
    throw new Error("The signed CampusGig Android APK was not produced");
  return apk;
}

async function startAppium() {
  try {
    const current = await fetch(`${appiumUrl}/status`);
    if (current.ok) return undefined;
  } catch {}
  const entrypoint = path.join(
    repoRoot,
    "node_modules",
    "appium",
    "build",
    "lib",
    "main.js",
  );
  if (!existsSync(entrypoint))
    throw new Error("Local Appium installation is missing");
  const parsed = new URL(appiumUrl);
  const child = spawn(
    process.execPath,
    [
      entrypoint,
      "--address",
      parsed.hostname,
      "--port",
      parsed.port || "4723",
      "--log-level",
      "warn",
    ],
    {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let startupLog = "";
  child.stdout?.on("data", (chunk) => (startupLog += chunk.toString()));
  child.stderr?.on("data", (chunk) => (startupLog += chunk.toString()));
  try {
    await waitFor(
      async () => {
        if (child.exitCode !== null)
          throw new Error(`Appium stopped during startup\n${startupLog}`);
        try {
          return (await fetch(`${appiumUrl}/status`)).ok;
        } catch {
          return false;
        }
      },
      "the local Appium server",
      90_000,
    );
  } catch (error) {
    child.kill();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${startupLog ? `\n${startupLog.trim()}` : ""}`);
  }
  return child;
}

async function webdriver<T>(
  sessionId: string | undefined,
  method: string,
  route: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `${appiumUrl}${sessionId ? `/session/${sessionId}` : ""}${route}`,
      {
        method,
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch (error) {
    throw new Error(
      `WebDriver ${method} ${route} did not respond within ${timeoutMs}ms`,
      { cause: error },
    );
  }
  const payload = (await response.json()) as {
    value?: T | { error?: string; message?: string };
    sessionId?: string;
  };
  const error = payload.value as
    | { error?: string; message?: string }
    | undefined;
  if (!response.ok || error?.error)
    throw new Error(
      error?.message ??
        `WebDriver ${method} ${route} failed with HTTP ${response.status}`,
    );
  return payload.value as T;
}

async function createAndroidSession(serial: string, apk: string) {
  const request = {
    capabilities: {
      alwaysMatch: {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:udid": serial,
        "appium:app": apk,
        "appium:appPackage": "com.campusgig.app",
        "appium:autoGrantPermissions": true,
        "appium:noSign": true,
        "appium:enforceAppInstall": true,
        "appium:noReset": false,
        "appium:fullReset": true,
        // The cross-client provider workflow can legitimately spend several
        // minutes in Chromium without issuing an Appium command.
        "appium:newCommandTimeout": 600,
        "appium:adbExecTimeout": 120_000,
        "appium:androidInstallTimeout": 180_000,
        "appium:uiautomator2ServerInstallTimeout": 120_000,
        "appium:uiautomator2ServerLaunchTimeout": 120_000,
      },
    },
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await webdriver<{ sessionId: string }>(
        undefined,
        "POST",
        "/session",
        request,
        240_000,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2 || !/authoriz|offline|adbexec/i.test(message))
        throw error;
      await run(adb, ["reconnect"], true);
      await waitForStableAdb(serial);
    }
  }
  throw new Error("Unable to create an Android Appium session");
}

async function reverseLocalDevelopmentPorts(serial: string) {
  const ports = new Set<number>();
  for (const value of [apiUrl, webUrl]) {
    const url = new URL(value);
    if (!localHosts.has(url.hostname)) continue;
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    ports.add(port);
  }
  for (const port of ports)
    await run(
      adb,
      ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`],
      true,
    );
}

async function findElement(
  sessionId: string,
  automationId: string,
  timeoutMs = 30_000,
) {
  let found: string | undefined;
  await waitFor(
    async () => {
      await dismissSystemUiAnr(sessionId);
      for (const using of ["accessibility id", "id"] as const) {
        let response: Response;
        try {
          response = await fetch(`${appiumUrl}/session/${sessionId}/element`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ using, value: automationId }),
            signal: AbortSignal.timeout(5_000),
          });
        } catch {
          continue;
        }
        if (!response.ok) continue;
        const payload = (await response.json()) as {
          value?: Record<string, string>;
        };
        found = payload.value?.[elementKey];
        if (found) {
          try {
            const visible = await webdriver<boolean>(
              sessionId,
              "GET",
              `/element/${found}/displayed`,
              undefined,
              5_000,
            );
            if (visible) return true;
          } catch {}
        }
      }
      return false;
    },
    `'${automationId}'`,
    timeoutMs,
  );
  return found!;
}

async function dismissSystemUiAnr(sessionId: string) {
  let response: Response;
  try {
    response = await fetch(`${appiumUrl}/session/${sessionId}/element`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ using: "id", value: "android:id/aerr_wait" }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return;
  }
  if (!response.ok) return;
  const payload = (await response.json()) as { value?: Record<string, string> };
  const waitButton = payload.value?.[elementKey];
  if (!waitButton) return;
  try {
    await webdriver(sessionId, "POST", `/element/${waitButton}/click`);
    await delay(1_000);
  } catch {}
}

async function setText(sessionId: string, automationId: string, text: string) {
  const element = await findElement(sessionId, automationId);
  await webdriver(sessionId, "POST", `/element/${element}/clear`);
  await webdriver(sessionId, "POST", `/element/${element}/value`, {
    text,
    value: [...text],
  });
}

async function typeAndroidText(
  sessionId: string,
  serial: string,
  automationId: string,
  text: string,
) {
  const element = await findElement(sessionId, automationId);
  await webdriver(sessionId, "POST", `/element/${element}/click`);
  await webdriver(sessionId, "POST", `/element/${element}/clear`);
  await run(
    adb,
    ["-s", serial, "shell", "input", "text", text.replaceAll(" ", "%s")],
    true,
  );
}

async function click(sessionId: string, automationId: string) {
  const element = await findElement(sessionId, automationId);
  await webdriver(sessionId, "POST", `/element/${element}/click`);
}

async function hideKeyboard(sessionId: string) {
  try {
    const shown = await webdriver<boolean>(
      sessionId,
      "GET",
      "/appium/device/is_keyboard_shown",
      undefined,
      5_000,
    );
    if (!shown) return;
    await webdriver(
      sessionId,
      "POST",
      "/appium/device/hide_keyboard",
      {},
      5_000,
    );
  } catch {
    // Appium reports an error when no soft keyboard is open; navigation must
    // remain untouched in either case.
  }
}

async function dismissAndroidKeyboard(sessionId: string, serial: string) {
  try {
    const shown = await webdriver<boolean>(
      sessionId,
      "GET",
      "/appium/device/is_keyboard_shown",
      undefined,
      5_000,
    );
    if (!shown) return;
    await run(adb, ["-s", serial, "shell", "input", "keyevent", "4"], true);
    await waitFor(
      async () =>
        !(await webdriver<boolean>(
          sessionId,
          "GET",
          "/appium/device/is_keyboard_shown",
          undefined,
          5_000,
        )),
      "the Android keyboard to close",
      5_000,
    );
  } catch {
    // Some keyboards do not expose visibility through UiAutomator. The
    // subsequent element lookup still reports a useful failure in that case.
  }
}

async function findText(sessionId: string, value: string, timeoutMs = 30_000) {
  let found: string | undefined;
  await waitFor(
    async () => {
      await dismissSystemUiAnr(sessionId);
      let response: Response;
      try {
        response = await fetch(`${appiumUrl}/session/${sessionId}/element`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            using: "xpath",
            value: `//*[@text=${JSON.stringify(value)}]`,
          }),
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        return false;
      }
      if (!response.ok) return false;
      const payload = (await response.json()) as {
        value?: Record<string, string>;
      };
      found = payload.value?.[elementKey];
      if (!found) return false;
      try {
        return await webdriver<boolean>(
          sessionId,
          "GET",
          `/element/${found}/displayed`,
          undefined,
          5_000,
        );
      } catch {
        return false;
      }
    },
    `text '${value}'`,
    timeoutMs,
  );
  return found!;
}

async function scrollUpToElement(
  sessionId: string,
  serial: string,
  automationId: string,
  attempts = 6,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await findElement(sessionId, automationId, 1_500);
    } catch {
      await swipeUp(serial);
      await delay(350);
    }
  }
  return await findElement(sessionId, automationId, 5_000);
}

async function androidScreenSize(serial: string) {
  const output = await run(adb, ["-s", serial, "shell", "wm", "size"], true);
  const matches = [
    ...output.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g),
  ];
  const match = matches.at(-1);
  if (!match)
    throw new Error(
      `Unable to determine Android screen size: ${output.trim()}`,
    );
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function swipeUp(serial: string) {
  const { width, height } = await androidScreenSize(serial);
  const x = Math.round(width * 0.5).toString();
  await run(
    adb,
    [
      "-s",
      serial,
      "shell",
      "input",
      "swipe",
      x,
      Math.round(height * 0.78).toString(),
      x,
      Math.round(height * 0.35).toString(),
      "400",
    ],
    true,
  );
}

async function scrollUpAndSetText(
  sessionId: string,
  serial: string,
  automationId: string,
  text: string,
  attempts = 10,
) {
  await hideKeyboard(sessionId);
  const element = await scrollUpToElement(
    sessionId,
    serial,
    automationId,
    attempts,
  );
  await webdriver(sessionId, "POST", `/element/${element}/clear`);
  await webdriver(sessionId, "POST", `/element/${element}/value`, {
    text,
    value: [...text],
  });
}

async function backUntilElement(
  sessionId: string,
  serial: string,
  automationId: string,
  attempts = 6,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await findElement(sessionId, automationId, 1_500);
    } catch {
      await run(adb, ["-s", serial, "shell", "input", "keyevent", "4"], true);
      await delay(450);
    }
  }
  return await findElement(sessionId, automationId, 5_000);
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const email = `e2e-mobile-client-${suffix}@example.test`;
  const displayName = `Android Client ${suffix}`;
  const password = "Android-Test-934!";
  const providerEmail = `e2e-mobile-provider-${suffix}@example.test`;
  const serviceTitle = `Android Request Journey ${suffix}`;
  const mobileDraftTitle = `Mobile Draft Service ${suffix}`;
  const mobileSubmittedTitle = `Mobile Submitted Service ${suffix}`;
  const fixtureSchoolId = randomUUID();
  const fixtureCategoryId = `e2e-${randomUUID()}`;
  let sessionId: string | undefined;
  let appiumProcess: ReturnType<typeof spawn> | undefined;
  let webProcess: ReturnType<typeof spawn> | undefined;
  let browser: Browser | undefined;
  let providerPage: Page | undefined;

  try {
    reportStep("checking API and creating disposable fixtures");
    await ensureApiIsReady();
    const school = await prisma.school.create({
      data: {
        id: fixtureSchoolId,
        name: `CampusGig Android Test School ${suffix}`,
        shortName: `E2E-${suffix}`,
        emailDomain: `android-${suffix}.example.test`,
        status: "ACTIVE",
      },
    });
    const category = await prisma.category.create({
      data: {
        id: fixtureCategoryId,
        name: `Android Testing ${suffix}`,
        icon: "E2E",
        color: "mint",
        sortOrder: -1,
      },
    });
    const passwordHash = await hash(password, 4);
    const client = await prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: "CLIENT" }] },
      },
    });
    const provider = await prisma.user.create({
      data: {
        email: providerEmail,
        displayName: `Android Provider ${suffix}`,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: {
          create: [
            { role: "CLIENT" },
            { role: "STUDENT" },
            { role: "PROVIDER" },
          ],
        },
        studentProfile: {
          create: {
            schoolId: school.id,
            verificationStatus: "APPROVED",
            verifiedAt: new Date(),
          },
        },
        providerProfile: {
          create: {
            headline: "Android journey provider",
            bio: "Disposable provider used for automated Android booking validation.",
            skills: ["Mobile testing"],
            isAvailable: true,
          },
        },
      },
    });
    const createdService = await prisma.service.create({
      data: {
        providerId: provider.id,
        categoryId: category.id,
        title: serviceTitle,
        slug: `android-request-${suffix}`,
        description:
          "Disposable single-price service used by the Android request journey.",
        deliveryMethod: "ONLINE",
        pricingModel: "SINGLE_PRICE_V2",
        basePriceCentavos: 95_000,
        normalDeliveryMinutes: 2 * 24 * 60,
        includedRevisionLimit: 1,
        acceptsRushOrders: false,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
    const serviceResponse = await fetch(
      `${apiUrl}/services/${createdService.id}`,
    );
    if (!serviceResponse.ok)
      throw new Error(
        `The disposable V2 service returned HTTP ${serviceResponse.status}`,
      );
    const servicePayload = (await serviceResponse.json()) as {
      acceptingOrders?: boolean;
      data?: { acceptingOrders?: boolean };
    };
    const publicService = servicePayload.data ?? servicePayload;
    if (publicService.acceptingOrders !== true)
      throw new Error("The disposable V2 service is not accepting orders");
    const configuredApk = process.env.E2E_ANDROID_APK
      ? path.resolve(repoRoot, process.env.E2E_ANDROID_APK)
      : undefined;
    if (configuredApk && !existsSync(configuredApk))
      throw new Error(`E2E_ANDROID_APK does not exist: ${configuredApk}`);
    // Booting an emulator and compiling a standalone MAUI APK together can
    // starve Android's System UI on developer machines and trigger a false ANR.
    reportStep("preparing Android device and application package");
    const serial = await ensureEmulator();
    const apk = configuredApk ?? (await buildAndroidApp(serial));
    reportStep("starting Appium and installing the Android application");
    appiumProcess = await startAppium();
    const created = await createAndroidSession(serial, apk);
    sessionId = created.sessionId;
    if (!sessionId)
      throw new Error("Appium did not return an Android session id");
    await reverseLocalDevelopmentPorts(serial);

    reportStep("completing first-launch onboarding");
    let onboardingVisible = false;
    try {
      await findElement(sessionId, "OnboardingNext", 10_000);
      onboardingVisible = true;
    } catch {}
    if (onboardingVisible) {
      for (let step = 0; step < 3; step += 1) {
        await click(sessionId, "OnboardingNext");
        await delay(450);
      }
    }

    reportStep("browsing as a guest and gating the service request");
    await findElement(sessionId, "AuthTitle", 45_000);
    await click(sessionId, "BrowseAsGuestButton");
    await findElement(sessionId, "DiscoverPage", 45_000);
    await setText(sessionId, "SearchServices", serviceTitle);
    const guestServiceCard = await scrollUpToElement(
      sessionId,
      serial,
      "ServiceCard",
    );
    await webdriver(sessionId, "POST", `/element/${guestServiceCard}/click`);
    await findElement(sessionId, "BookingTitle");
    const guestRequest = await scrollUpToElement(
      sessionId,
      serial,
      "BookingSubmit",
    );
    await webdriver(sessionId, "POST", `/element/${guestRequest}/click`);
    const continueToAuth = await findText(sessionId, "Log in or sign up");
    await webdriver(sessionId, "POST", `/element/${continueToAuth}/click`);

    reportStep("signing in and restoring the selected service");
    await findElement(sessionId, "AuthTitle", 30_000);
    await setText(sessionId, "LoginEmail", email);
    await setText(sessionId, "LoginPassword", password);
    await click(sessionId, "LoginSubmit");
    await findElement(sessionId, "BookingTitle", 45_000);
    await run(adb, ["-s", serial, "shell", "input", "keyevent", "4"], true);
    await findElement(sessionId, "DiscoverPage", 30_000);

    reportStep("checking authenticated navigation and session restoration");
    await click(sessionId, "TabOrders");
    await findElement(sessionId, "OrdersTitle");
    await click(sessionId, "TabMessages");
    await findElement(sessionId, "MessagesTitle");
    await click(sessionId, "TabProfile");
    await findElement(sessionId, "ProfileTitle");
    await click(sessionId, "TabDiscover");
    await findElement(sessionId, "DiscoverPage");

    await run(adb, ["-s", serial, "shell", "input", "keyevent", "3"], true);
    await delay(2_000);
    await run(
      adb,
      [
        "-s",
        serial,
        "shell",
        "monkey",
        "-p",
        "com.campusgig.app",
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ],
      true,
    );
    await findElement(sessionId, "DiscoverPage", 30_000);

    reportStep(
      "creating a single-price V2 service request through the Android interface",
    );
    await setText(sessionId, "SearchServices", serviceTitle);
    const requestServiceCard = await scrollUpToElement(
      sessionId,
      serial,
      "ServiceCard",
    );
    await webdriver(sessionId, "POST", `/element/${requestServiceCard}/click`);
    await findElement(sessionId, "BookingTitle");
    await typeAndroidText(
      sessionId,
      serial,
      "BookingRequirements",
      "Create the disposable Android end-to-end test deliverable.",
    );
    await dismissAndroidKeyboard(sessionId, serial);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await swipeUp(serial);
      await delay(350);
    }
    const bookingSubmit = await findElement(sessionId, "BookingSubmit");
    await waitFor(
      async () =>
        (await webdriver<string>(
          sessionId,
          "GET",
          `/element/${bookingSubmit}/attribute/enabled`,
        )) === "true",
      "the single-price request action to become enabled",
      15_000,
    );
    const bookingSubmitEnabled = await webdriver<string>(
      sessionId,
      "GET",
      `/element/${bookingSubmit}/attribute/enabled`,
    );
    const bookingSubmitText = await webdriver<string>(
      sessionId,
      "GET",
      `/element/${bookingSubmit}/text`,
    );
    reportStep(
      `single-price submit state: enabled=${bookingSubmitEnabled}, text=${bookingSubmitText}`,
    );
    await webdriver(sessionId, "POST", `/element/${bookingSubmit}/click`);
    const confirmRequest = await findText(sessionId, "Send request");
    await webdriver(sessionId, "POST", `/element/${confirmRequest}/click`);
    await findText(sessionId, "Request sent", 30_000);
    const acknowledgeRequest = await findText(sessionId, "OK");
    await webdriver(sessionId, "POST", `/element/${acknowledgeRequest}/click`);
    await findElement(sessionId, "OrdersTitle", 30_000);
    await findText(sessionId, serviceTitle, 30_000);

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id, titleSnapshot: serviceTitle },
    });
    if (order.status !== "REQUESTED")
      throw new Error(
        `Expected the Android single-price request to be REQUESTED, received ${order.status}`,
      );

    const submittedAt = new Date();
    const reviewDeadlineAt = new Date(
      submittedAt.getTime() + 48 * 60 * 60 * 1000,
    );
    const deliverySubmissionId = randomUUID();
    const paymentId = randomUUID();
    const providerPrincipal = order.totalCentavos - order.platformFeeCentavos;
    await prisma.$transaction([
      prisma.deliverySubmission.create({
        data: {
          id: deliverySubmissionId,
          orderId: order.id,
          providerId: provider.id,
          version: 1,
          note: "Android E2E delivery fixture",
          submittedAt,
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: {
          status: "SUBMITTED",
          acceptedAt: submittedAt,
          startedAt: submittedAt,
          submittedAt,
          reviewPolicyVersion: 1,
          reviewStartedAt: submittedAt,
          reviewDeadlineAt,
          reviewDeliverySubmissionId: deliverySubmissionId,
        },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: "IN_PROGRESS",
          toStatus: "SUBMITTED",
          changedBy: provider.id,
          note: "Android E2E delivery fixture",
        },
      }),
      prisma.payment.create({
        data: {
          id: paymentId,
          orderId: order.id,
          idempotencyKey: `android-e2e-payment-${suffix}`,
          amountCentavos: order.totalCentavos,
          platformFeeCentavos: order.platformFeeCentavos,
          providerNetCentavos: providerPrincipal,
          status: "PAID",
          paidAt: submittedAt,
        },
      }),
      prisma.providerEarning.create({
        data: {
          providerId: provider.id,
          orderId: order.id,
          paymentId,
          currency: order.currency,
          grossServiceAmountCentavos: providerPrincipal,
          status: "PENDING",
          pendingAt: submittedAt,
          ledgerEntries: {
            create: {
              providerId: provider.id,
              orderId: order.id,
              sourcePaymentId: paymentId,
              type: "EARNING_PENDING_CREDIT",
              amountCentavos: providerPrincipal,
              currency: order.currency,
              sourceKey: `payment:${paymentId}:earning-pending-credit`,
              createdAt: submittedAt,
            },
          },
        },
      }),
    ]);

    reportStep("opening the provider dashboard in Chromium");
    webProcess = await startWebIfNeeded();
    browser = await chromium.launch({ headless: true });
    providerPage = await browser.newPage();
    const accessUrl = new URL(webUrl);
    accessUrl.searchParams.set("view", "access");
    await providerPage.goto(accessUrl.toString());
    const providerEmailInput = providerPage.getByLabel("Email address");
    await providerEmailInput.waitFor({ state: "visible", timeout: 60_000 });
    await providerEmailInput.fill(providerEmail);
    await providerPage.locator('input[type="password"]').fill(password);
    await providerPage
      .getByRole("button", { name: "Continue to CampusGig" })
      .click();
    await expect(
      providerPage.getByRole("heading", { name: "Provider dashboard" }),
    ).toBeVisible({ timeout: 30_000 });
    const providerOrder = providerPage
      .locator(".provider-request")
      .filter({ hasText: serviceTitle });
    await expect(providerOrder).toHaveCount(1);
    await expect(
      providerOrder.locator('[data-status="SUBMITTED"]'),
    ).toBeVisible();
    const completedCard = providerPage
      .locator(".stat-card")
      .filter({ hasText: "Completed orders" });
    const ratingCard = providerPage
      .locator(".stat-card")
      .filter({ hasText: "Average rating" });
    await expect(completedCard.locator("strong")).toHaveText("0");
    await expect(ratingCard.locator("strong")).toHaveText("0.0");
    await expect(ratingCard).toContainText("From 0 reviews");

    reportStep("accepting the submitted delivery on Android");
    await click(sessionId, "TabDiscover");
    await delay(750);
    await click(sessionId, "TabOrders");
    await findElement(sessionId, "OrdersTitle");
    await findText(sessionId, serviceTitle, 30_000);
    await click(sessionId, "OrderCard");
    await findElement(sessionId, "OrderWorkspace", 30_000);
    const acceptDelivery = await scrollUpToElement(
      sessionId,
      serial,
      "AcceptDeliveryButton",
    );
    await webdriver(sessionId, "POST", `/element/${acceptDelivery}/click`);
    const confirmDelivery = await findText(sessionId, "Accept delivery");
    await webdriver(sessionId, "POST", `/element/${confirmDelivery}/click`);
    await findText(sessionId, "Delivery accepted", 30_000);
    const acknowledgeDelivery = await findText(sessionId, "OK");
    await webdriver(sessionId, "POST", `/element/${acknowledgeDelivery}/click`);

    await waitFor(
      async () =>
        (await prisma.order.findUnique({ where: { id: order.id } }))?.status ===
        "COMPLETED",
      "the Android client to complete the order",
      15_000,
    );
    const completedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        providerEarnings: { include: { ledgerEntries: true } },
      },
    });
    if (completedOrder.completionSource !== "CLIENT_ACCEPTED")
      throw new Error(
        `Expected CLIENT_ACCEPTED completion, received ${completedOrder.completionSource}`,
      );
    const originalEarning = completedOrder.providerEarnings.find(
      (earning) => earning.sourceType === "ORIGINAL_ORDER",
    );
    if (originalEarning?.status !== "AVAILABLE")
      throw new Error("Expected the Android acceptance to release the earning");
    const releaseEntries = originalEarning.ledgerEntries.filter(
      (entry) => entry.type === "EARNING_AVAILABLE_RELEASE",
    );
    if (releaseEntries.length !== 1 || releaseEntries[0].amountCentavos !== 0)
      throw new Error("Expected one zero-value earning release audit event");
    await expect(
      providerOrder.locator('[data-status="COMPLETED"]'),
    ).toBeVisible({ timeout: 15_000 });
    await expect(completedCard.locator("strong")).toHaveText("1", {
      timeout: 15_000,
    });

    reportStep("submitting a five-star review on Android");
    const ratingButton = await scrollUpToElement(
      sessionId,
      serial,
      "Rating5Button",
    );
    await webdriver(sessionId, "POST", `/element/${ratingButton}/click`);
    await scrollUpAndSetText(
      sessionId,
      serial,
      "ReviewComment",
      "Excellent delivery from the automated Android journey.",
    );
    await hideKeyboard(sessionId);
    const submitReview = await scrollUpToElement(
      sessionId,
      serial,
      "SubmitReviewButton",
    );
    await webdriver(sessionId, "POST", `/element/${submitReview}/click`);
    const confirmReview = await findText(sessionId, "Submit review");
    await webdriver(sessionId, "POST", `/element/${confirmReview}/click`);
    await findText(sessionId, "Review submitted", 30_000);
    const acknowledgeReview = await findText(sessionId, "OK");
    await webdriver(sessionId, "POST", `/element/${acknowledgeReview}/click`);

    await waitFor(
      async () =>
        (await prisma.review.count({ where: { orderId: order.id } })) === 1,
      "the Android review to be stored",
      15_000,
    );
    await expect(ratingCard.locator("strong")).toHaveText("5.0", {
      timeout: 15_000,
    });
    await expect(ratingCard).toContainText("From 1 reviews", {
      timeout: 15_000,
    });

    reportStep("sending a pre-order inquiry from the provider public profile");
    await backUntilElement(sessionId, serial, "OrdersTitle");
    await click(sessionId, "TabDiscover");
    const inquiryServiceCard = await scrollUpToElement(
      sessionId,
      serial,
      "ServiceCard",
    );
    await webdriver(sessionId, "POST", `/element/${inquiryServiceCard}/click`);
    await findElement(sessionId, "BookingTitle");
    await click(sessionId, "ProviderProfileLink");
    await findElement(sessionId, "MessageProviderButton", 30_000);
    await click(sessionId, "MessageProviderButton");
    await scrollUpToElement(sessionId, serial, "MessageDraft", 10);
    const emptyInquiry = await prisma.conversation.findUniqueOrThrow({
      where: {
        clientId_providerId: { clientId: client.id, providerId: provider.id },
      },
      select: { id: true },
    });
    const inboxLoginResponse = await fetch(`${apiUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, clientType: "MOBILE" }),
    });
    if (!inboxLoginResponse.ok)
      throw new Error("Could not authenticate the inquiry inbox assertion");
    const inboxSession = (await inboxLoginResponse.json()) as {
      accessToken: string;
    };
    const readInquiryInbox = async () => {
      const response = await fetch(`${apiUrl}/conversations`, {
        headers: { Authorization: `Bearer ${inboxSession.accessToken}` },
      });
      if (!response.ok)
        throw new Error(`Could not read inquiry inbox (${response.status})`);
      return (await response.json()) as { data: Array<{ id: string }> };
    };
    if (
      (await readInquiryInbox()).data.some(
        (item) => item.id === emptyInquiry.id,
      )
    )
      throw new Error("An empty provider inquiry appeared in Messages");
    const inquiryText = `Pre-order Android inquiry ${suffix}`;
    await scrollUpAndSetText(sessionId, serial, "MessageDraft", inquiryText);
    await click(sessionId, "SendMessageButton");
    await waitFor(
      async () =>
        (await prisma.message.count({
          where: {
            body: inquiryText,
            conversation: {
              kind: "INQUIRY",
              clientId: client.id,
              providerId: provider.id,
            },
          },
        })) === 1,
      "the pre-order provider inquiry to be stored",
      15_000,
    );
    await waitFor(
      async () =>
        (await readInquiryInbox()).data.some(
          (item) => item.id === emptyInquiry.id,
        ),
      "the sent provider inquiry to appear in Messages",
      15_000,
    );

    reportStep("switching the Android app to the disposable provider");
    await backUntilElement(sessionId, serial, "TabProfile");
    await click(sessionId, "TabProfile");
    await findElement(sessionId, "ProfileTitle", 30_000);
    const signOut = await scrollUpToElement(
      sessionId,
      serial,
      "ProfileSignOut",
      20,
    );
    await webdriver(sessionId, "POST", `/element/${signOut}/click`);
    const confirmSignOut = await findElement(
      sessionId,
      "android:id/button1",
      10_000,
    );
    await webdriver(sessionId, "POST", `/element/${confirmSignOut}/click`);
    await findElement(sessionId, "AuthTitle", 30_000);
    await setText(sessionId, "LoginEmail", providerEmail);
    await setText(sessionId, "LoginPassword", password);
    await click(sessionId, "LoginSubmit");
    await findElement(sessionId, "DiscoverPage", 45_000);

    reportStep("creating a provider service draft through the Android editor");
    await click(sessionId, "TabProfile");
    await findElement(sessionId, "ProfileTitle");
    const listingsRow = await scrollUpToElement(
      sessionId,
      serial,
      "ProviderListingsRow",
      12,
    );
    await webdriver(sessionId, "POST", `/element/${listingsRow}/click`);
    await findElement(sessionId, "ProviderListingsTitle", 30_000);
    reportStep("checking the redesigned provider listing preview");
    await click(sessionId, "ProviderListingPreview");
    await findElement(sessionId, "ListingPreviewBack", 30_000);
    await findText(sessionId, "CLIENT PREVIEW");
    await click(sessionId, "ListingPreviewBack");
    await findElement(sessionId, "ProviderListingsTitle", 30_000);
    await click(sessionId, "ProviderNewListing");
    await findElement(sessionId, "ListingTitleEntry", 30_000);
    await findText(sessionId, category.name, 30_000);
    await setText(sessionId, "ListingTitleEntry", mobileDraftTitle);
    await setText(
      sessionId,
      "ListingDescriptionEditor",
      "A disposable mobile-created listing that verifies provider draft editing and moderation submission.",
    );
    await hideKeyboard(sessionId);
    const detailsNext = await scrollUpToElement(
      sessionId,
      serial,
      "ListingDetailsNext",
      8,
    );
    await webdriver(sessionId, "POST", `/element/${detailsNext}/click`);
    await findElement(sessionId, "ListingBasePrice", 10_000);
    await setText(sessionId, "ListingBasePrice", "725");
    await hideKeyboard(sessionId);
    const pricingNext = await scrollUpToElement(
      sessionId,
      serial,
      "ListingPricingNext",
      8,
    );
    await webdriver(sessionId, "POST", `/element/${pricingNext}/click`);
    await findElement(sessionId, "ListingMediaNext", 10_000);
    await click(sessionId, "ListingMediaNext");
    const saveDraft = await scrollUpToElement(
      sessionId,
      serial,
      "ListingSaveDraft",
      14,
    );
    await webdriver(sessionId, "POST", `/element/${saveDraft}/click`);
    await findText(sessionId, "Draft saved", 30_000);
    const acknowledgeDraft = await findText(sessionId, "OK", 10_000);
    await webdriver(sessionId, "POST", `/element/${acknowledgeDraft}/click`);
    await findElement(sessionId, "ProviderListingsTitle", 30_000);

    const mobileDraft = await prisma.service.findFirstOrThrow({
      where: { providerId: provider.id, title: mobileDraftTitle },
      include: { packages: true, media: true },
    });
    if (mobileDraft.status !== "DRAFT")
      throw new Error(
        `Expected the mobile-created service to be DRAFT, received ${mobileDraft.status}`,
      );
    if (
      mobileDraft.pricingModel !== "SINGLE_PRICE_V2" ||
      mobileDraft.basePriceCentavos !== 72_500 ||
      mobileDraft.packages.length !== 0
    )
      throw new Error(
        "The mobile-created fixed-price terms were not persisted correctly",
      );

    reportStep("editing and submitting the provider listing from Android");
    const editListing = await scrollUpToElement(
      sessionId,
      serial,
      "ProviderListingEdit",
      8,
    );
    await webdriver(sessionId, "POST", `/element/${editListing}/click`);
    await findElement(sessionId, "ListingTitleEntry", 30_000);
    await findText(sessionId, category.name, 30_000);
    await setText(sessionId, "ListingTitleEntry", mobileSubmittedTitle);
    await hideKeyboard(sessionId);
    const editDetailsNext = await scrollUpToElement(
      sessionId,
      serial,
      "ListingDetailsNext",
      8,
    );
    await webdriver(sessionId, "POST", `/element/${editDetailsNext}/click`);
    await findElement(sessionId, "ListingPricingNext", 10_000);
    const editPricingNext = await scrollUpToElement(
      sessionId,
      serial,
      "ListingPricingNext",
      8,
    );
    await webdriver(sessionId, "POST", `/element/${editPricingNext}/click`);
    await findElement(sessionId, "ListingMediaNext", 10_000);
    await click(sessionId, "ListingMediaNext");
    const saveAndSubmit = await scrollUpToElement(
      sessionId,
      serial,
      "ListingSaveAndSubmit",
      14,
    );
    await webdriver(sessionId, "POST", `/element/${saveAndSubmit}/click`);
    await findText(sessionId, "Submit for review?", 10_000);
    const confirmSubmit = await findText(sessionId, "Submit", 10_000);
    await webdriver(sessionId, "POST", `/element/${confirmSubmit}/click`);
    await findText(sessionId, "Submitted for review", 30_000);
    const acknowledgeSubmission = await findText(sessionId, "OK", 10_000);
    await webdriver(
      sessionId,
      "POST",
      `/element/${acknowledgeSubmission}/click`,
    );
    await findElement(sessionId, "ProviderListingsTitle", 30_000);
    await waitFor(
      async () =>
        (
          await prisma.service.findUnique({
            where: { id: mobileDraft.id },
            select: { status: true, title: true },
          })
        )?.status === "PENDING_REVIEW",
      "the mobile provider listing to enter administrator review",
      15_000,
    );
    const submittedListing = await prisma.service.findUniqueOrThrow({
      where: { id: mobileDraft.id },
      include: { packages: true },
    });
    if (submittedListing.title !== mobileSubmittedTitle)
      throw new Error("The edited mobile listing title was not persisted");
    if (
      submittedListing.pricingModel !== "SINGLE_PRICE_V2" ||
      submittedListing.basePriceCentavos !== 72_500 ||
      submittedListing.packages.length !== 0
    )
      throw new Error(
        "Editing the mobile listing changed its fixed-price terms unexpectedly",
      );
    await findText(sessionId, "PENDING REVIEW", 15_000);

    reportStep(
      "completed-order, review, inquiry, and provider-listing flows verified",
    );
    console.log(
      "Android E2E passed: guest browsing, login restoration, pre-order provider inquiry, primary tabs, background restoration, request creation, delivery acceptance, review submission, live provider-dashboard synchronization, and mobile provider listing creation/editing/submission are functional.",
    );
  } catch (error) {
    if (providerPage) {
      try {
        mkdirSync(path.join(repoRoot, "test-results"), { recursive: true });
        await providerPage.screenshot({
          path: path.join(
            repoRoot,
            "test-results",
            "mobile-e2e-web-failure.png",
          ),
          fullPage: true,
        });
        console.error(`[android-e2e] browser URL: ${providerPage.url()}`);
      } catch {}
    }
    if (sessionId) {
      try {
        const screenshot = await webdriver<string>(
          sessionId,
          "GET",
          "/screenshot",
        );
        mkdirSync(path.join(repoRoot, "test-results"), { recursive: true });
        writeFileSync(
          path.join(repoRoot, "test-results", "mobile-e2e-failure.png"),
          screenshot,
          "base64",
        );
      } catch {}
    }
    throw error;
  } finally {
    if (sessionId) {
      try {
        await webdriver(sessionId, "DELETE", "");
      } catch {}
    }
    await browser?.close().catch(() => undefined);
    appiumProcess?.kill();
    webProcess?.kill();
    const disposableUsers = await prisma.user.findMany({
      where: { email: { in: [email, providerEmail] } },
      select: { id: true },
    });
    const disposableUserIds = disposableUsers.map(({ id }) => id);
    if (disposableUserIds.length) {
      const disposableOrders = await prisma.order.findMany({
        where: {
          OR: [
            { clientId: { in: disposableUserIds } },
            { providerId: { in: disposableUserIds } },
          ],
        },
        select: { id: true },
      });
      const disposableOrderIds = disposableOrders.map(({ id }) => id);
      if (disposableOrderIds.length) {
        await prisma.review.deleteMany({
          where: { orderId: { in: disposableOrderIds } },
        });
        await prisma.providerEarningLedgerEntry.deleteMany({
          where: { orderId: { in: disposableOrderIds } },
        });
        await prisma.providerEarning.deleteMany({
          where: { orderId: { in: disposableOrderIds } },
        });
        await prisma.payment.deleteMany({
          where: { orderId: { in: disposableOrderIds } },
        });
      }
      await prisma.order.deleteMany({
        where: {
          OR: [
            { clientId: { in: disposableUserIds } },
            { providerId: { in: disposableUserIds } },
          ],
        },
      });
      await prisma.conversation.deleteMany({
        where: {
          OR: [
            { clientId: { in: disposableUserIds } },
            { providerId: { in: disposableUserIds } },
          ],
        },
      });
      await prisma.service.deleteMany({
        where: { providerId: { in: disposableUserIds } },
      });
      await prisma.verificationRequest.deleteMany({
        where: { userId: { in: disposableUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: disposableUserIds } },
      });
    }
    await prisma.category.deleteMany({ where: { id: fixtureCategoryId } });
    await prisma.school.deleteMany({ where: { id: fixtureSchoolId } });
    const remaining = await prisma.user.count({
      where: { email: { in: [email, providerEmail] } },
    });
    if (remaining !== 0)
      throw new Error("Disposable Android E2E account was not fully removed");
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
});
