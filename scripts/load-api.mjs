const apiBaseUrl = process.env.LOAD_TEST_API_URL ?? "http://127.0.0.1:4000/api/v1";
const parsedUrl = new URL(apiBaseUrl);
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
if (!localHosts.has(parsedUrl.hostname) && process.env.LOAD_TEST_ALLOW_REMOTE !== "true")
  throw new Error("Remote load testing requires LOAD_TEST_ALLOW_REMOTE=true");

const users = Math.min(500, Math.max(1, Number(process.env.LOAD_TEST_USERS ?? 25)));
const durationMs = Math.min(
  300_000,
  Math.max(1_000, Number(process.env.LOAD_TEST_DURATION_SECONDS ?? 15) * 1_000),
);
const target = new URL("services?page=1", `${apiBaseUrl.replace(/\/$/, "")}/`);
const endsAt = Date.now() + durationMs;
const durations = [];
const statuses = new Map();
let networkErrors = 0;

async function worker() {
  while (Date.now() < endsAt) {
    const startedAt = performance.now();
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(10_000) });
      await response.arrayBuffer();
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
    } catch {
      networkErrors++;
    } finally {
      durations.push(performance.now() - startedAt);
    }
  }
}

await Promise.all(Array.from({ length: users }, () => worker()));
durations.sort((left, right) => left - right);
const percentile = (value) =>
  durations[Math.min(durations.length - 1, Math.floor(durations.length * value))] ?? 0;
const requests = durations.length;
const serverErrors = [...statuses.entries()]
  .filter(([status]) => status >= 500)
  .reduce((total, [, count]) => total + count, 0);

console.log(
  JSON.stringify(
    {
      target: target.toString(),
      users,
      durationSeconds: durationMs / 1_000,
      requests,
      requestsPerSecond: Number((requests / (durationMs / 1_000)).toFixed(2)),
      latencyMs: {
        p50: Number(percentile(0.5).toFixed(2)),
        p95: Number(percentile(0.95).toFixed(2)),
        p99: Number(percentile(0.99).toFixed(2)),
      },
      statuses: Object.fromEntries([...statuses.entries()].sort()),
      networkErrors,
      serverErrors,
    },
    null,
    2,
  ),
);

if (networkErrors > 0 || serverErrors > 0) process.exitCode = 1;
