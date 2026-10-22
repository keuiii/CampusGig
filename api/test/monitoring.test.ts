import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  HttpMetricsMiddleware,
  normalizeMetricRoute,
} from "../src/monitoring/http-metrics.middleware";
import { MetricsAccessGuard } from "../src/monitoring/metrics-access.guard";
import { MetricsService } from "../src/monitoring/metrics.service";
import { SystemHealthService } from "../src/monitoring/system-health.service";
import { PaymentWebhooksController } from "../src/modules/payments/payments.controller";

function config(values: Record<string, string>) {
  return { get: (key: string) => values[key] } as never;
}

function guardContext(request: object) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

test("metric routes remove query strings and user-controlled identifiers", () => {
  assert.equal(
    normalizeMetricRoute(
      "/api/v1/orders/550e8400-e29b-41d4-a716-446655440000?email=secret@example.com",
    ),
    "/api/v1/orders/:id",
  );
  assert.equal(
    normalizeMetricRoute("/api/v1/orders/CG-2026-9573B686/files/123"),
    "/api/v1/orders/:id/files/:id",
  );
  assert.equal(
    normalizeMetricRoute(
      `/${Array.from({ length: 60 }, () => "route").join("/")}`,
    ),
    "/oversized-route",
  );
});

test("metrics require a constant-length bearer secret outside local development", () => {
  assert.throws(
    () => new MetricsAccessGuard(config({ NODE_ENV: "production" })),
    /Production requires METRICS_TOKEN/,
  );
  assert.throws(
    () =>
      new MetricsAccessGuard(
        config({ NODE_ENV: "production", METRICS_TOKEN: "short" }),
      ),
    /at least 32 characters/,
  );
  const token = "m".repeat(40);
  const guard = new MetricsAccessGuard(
    config({ NODE_ENV: "production", METRICS_TOKEN: token }),
  );
  assert.equal(
    guard.canActivate(
      guardContext({ headers: { authorization: `Bearer ${token}` } }),
    ),
    true,
  );
  assert.throws(
    () =>
      guard.canActivate(
        guardContext({ headers: { authorization: "Bearer incorrect" } }),
      ),
    /Unauthorized/,
  );
});

test("HTTP telemetry uses bounded method, route, and status labels", async () => {
  const metrics = new MetricsService();
  const middleware = new HttpMetricsMiddleware(metrics);
  const response = new EventEmitter() as EventEmitter & { statusCode: number };
  response.statusCode = 201;
  let continued = false;
  middleware.use(
    {
      method: "POST",
      originalUrl: "/api/v1/orders/CG-2026-ABCDEF?token=private",
    } as never,
    response as never,
    () => {
      continued = true;
    },
  );
  response.emit("finish");
  const output = await metrics.render();
  assert.equal(continued, true);
  assert.match(
    output,
    /campusgig_http_requests_total\{method="POST",route="\/api\/v1\/orders\/:id",status="201"\} 1/,
  );
  assert.doesNotMatch(output, /private|ABCDEF/);
});

test("readiness fails closed and updates dependency gauges", async () => {
  const metrics = new MetricsService();
  const health = new SystemHealthService(
    config({ READINESS_TIMEOUT_MS: "500" }),
    { $queryRaw: async () => [1] } as never,
    { healthCheck: async () => undefined } as never,
    {
      healthCheck: async () => Promise.reject(new Error("S3 unavailable")),
    } as never,
    metrics,
  );
  assert.deepEqual(await health.readiness(), { status: "not_ready" });
  const output = await metrics.render();
  assert.match(output, /campusgig_dependency_up\{dependency="database"\} 1/);
  assert.match(
    output,
    /campusgig_dependency_up\{dependency="malware_scanner"\} 1/,
  );
  assert.match(output, /campusgig_dependency_up\{dependency="storage"\} 0/);
});

test("concurrent readiness probes share one bounded dependency check", async () => {
  const calls = { database: 0, scanner: 0, storage: 0 };
  const health = new SystemHealthService(
    config({ READINESS_TIMEOUT_MS: "500" }),
    {
      $queryRaw: async () => {
        calls.database++;
        return [1];
      },
    } as never,
    {
      healthCheck: async () => {
        calls.scanner++;
      },
    } as never,
    {
      healthCheck: async () => {
        calls.storage++;
      },
    } as never,
    new MetricsService(),
  );
  assert.deepEqual(
    await Promise.all([health.readiness(), health.readiness()]),
    [{ status: "ready" }, { status: "ready" }],
  );
  assert.deepEqual(calls, { database: 1, scanner: 1, storage: 1 });
  assert.deepEqual(await health.readiness(), { status: "ready" });
  assert.deepEqual(calls, { database: 1, scanner: 1, storage: 1 });
});

test("PayMongo webhook failures are counted by safe processing stage", async () => {
  const stages: string[] = [];
  const controller = new PaymentWebhooksController(
    { processWebhook: async () => undefined } as never,
    {
      verifyWebhook: () => {
        throw new Error("bad signature");
      },
    } as never,
    { recordWebhookFailure: (stage: string) => stages.push(stage) } as never,
  );
  await assert.rejects(
    controller.webhook(
      { rawBody: Buffer.from("{}"), body: {} } as never,
      "invalid",
    ),
    /bad signature/,
  );
  assert.deepEqual(stages, ["signature"]);
});
