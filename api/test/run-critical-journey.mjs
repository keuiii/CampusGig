import { spawn } from "node:child_process";
import { once } from "node:events";

if (!process.env.DATABASE_URL) process.loadEnvFile(".env");

const apiOrigin = "http://127.0.0.1:4200";
const apiUrl = `${apiOrigin}/api/v1`;
const testEnvironment = {
  ...process.env,
  NODE_ENV: "test",
  PORT: "4200",
  WEB_ORIGIN: "http://127.0.0.1:3100",
  E2E_API_URL: apiUrl,
  SMTP_USER: "",
  SMTP_APP_PASSWORD: "",
  RESEND_API_KEY: "",
  EMAIL_FROM: "",
  STORAGE_DRIVER: "local",
};

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function ensurePortIsAvailable() {
  try {
    const response = await fetch(`${apiUrl}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (response.ok)
      throw new Error(
        `Refusing to reuse an API already running at ${apiOrigin}; the E2E harness must own its test server`,
      );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing"))
      throw error;
  }
}

async function waitForApi(server) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`The E2E API exited during startup (${server.exitCode})`);
    try {
      const response = await fetch(`${apiUrl}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error("Timed out waiting for the E2E API");
}

async function runJourney() {
  const journey = spawn(
    process.execPath,
    ["--import", "tsx", "--test", "test/critical-journey.e2e.ts"],
    {
      cwd: process.cwd(),
      env: testEnvironment,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const [code, signal] = await once(journey, "exit");
  if (code !== 0)
    throw new Error(
      `Critical E2E journey failed${code === null ? ` after signal ${signal}` : ` with exit code ${code}`}`,
    );
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill();
  await Promise.race([
    once(server, "exit"),
    delay(5_000).then(() => {
      throw new Error("The owned E2E API did not stop within five seconds");
    }),
  ]);
}

await ensurePortIsAvailable();
const server = spawn(process.execPath, ["dist/main.js"], {
  cwd: process.cwd(),
  env: testEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);

try {
  await waitForApi(server);
  await runJourney();
} finally {
  await stopServer(server);
}
