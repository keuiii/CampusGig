import { spawn } from "node:child_process";
import { once } from "node:events";

if (!process.env.DATABASE_URL) process.loadEnvFile("api/.env");

const defaultWebUrl = "http://127.0.0.1:3100";
const defaultApiUrl = "http://127.0.0.1:4100/api/v1";
const webUrl = process.env.E2E_WEB_URL ?? defaultWebUrl;
const apiUrl = process.env.E2E_API_URL ?? defaultApiUrl;
const ownsWebServer = !process.env.E2E_WEB_URL;
const ownsApiServer = !process.env.E2E_API_URL;
const ownedServers = [];
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function assertUrlIsUnused(url, name) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
  } catch {
    return;
  }
  throw new Error(
    `Refusing to reuse ${name} at ${url}; the E2E harness must own its local test server`,
  );
}

async function waitForUrl(url, server, name, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`${name} exited during startup (${server.exitCode})`);
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status < 500) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${name} at ${url}`);
}

function startServer(command, args, options) {
  const server = spawn(command, args, {
    ...options,
    stdio: "inherit",
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  ownedServers.push(server);
  return server;
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, "exit");
  if (process.platform === "win32") server.kill();
  else process.kill(-server.pid, "SIGTERM");
  await Promise.race([
    exited,
    delay(5_000).then(() => {
      throw new Error(`Owned E2E server ${server.pid} did not stop`);
    }),
  ]);
}

async function runPlaywright() {
  const runner = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      env: { ...process.env, E2E_WEB_URL: webUrl, E2E_API_URL: apiUrl },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const [code, signal] = await once(runner, "exit");
  if (code !== 0)
    throw new Error(
      `Playwright failed${code === null ? ` after signal ${signal}` : ` with exit code ${code}`}`,
    );
}

try {
  let apiServer;
  if (ownsApiServer) {
    await assertUrlIsUnused(`${apiUrl}/health`, "API");
    const parsedApiUrl = new URL(apiUrl);
    apiServer = startServer(process.execPath, ["dist/main.js"], {
      cwd: new URL("../api", import.meta.url),
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: parsedApiUrl.port,
        WEB_ORIGIN: new URL(webUrl).origin,
        SMTP_USER: "",
        SMTP_APP_PASSWORD: "",
        RESEND_API_KEY: "",
        EMAIL_FROM: "",
        STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? "local",
        MALWARE_SCANNER_DRIVER: process.env.MALWARE_SCANNER_DRIVER ?? "clamav",
        CLAMAV_HOST: process.env.CLAMAV_HOST ?? "127.0.0.1",
        CLAMAV_PORT: process.env.CLAMAV_PORT ?? "3310",
      },
    });
    await waitForUrl(`${apiUrl}/health`, apiServer, "API", 120_000);
  }

  if (ownsWebServer) {
    await assertUrlIsUnused(webUrl, "Web application");
    const parsedWebUrl = new URL(webUrl);
    const webServer = startServer(
      process.execPath,
      ["scripts/start-next-e2e.mjs"],
      {
        cwd: new URL("..", import.meta.url),
        env: {
          ...process.env,
          E2E_WEB_HOST: parsedWebUrl.hostname,
          E2E_WEB_PORT: parsedWebUrl.port,
          NEXT_PUBLIC_API_URL: new URL(apiUrl).origin,
          NEXT_DIST_DIR: ".next-e2e",
        },
      },
    );
    await waitForUrl(webUrl, webServer, "Web application", 240_000);
  }

  await runPlaywright();
} finally {
  const cleanupResults = await Promise.allSettled(
    ownedServers.reverse().map(stopServer),
  );
  const cleanupFailure = cleanupResults.find(
    (result) => result.status === "rejected",
  );
  if (cleanupFailure?.status === "rejected") throw cleanupFailure.reason;
}
