import assert from "node:assert/strict";
import test from "node:test";
import { RequestRateLimitMiddleware } from "../src/security/request-rate-limit.middleware";
import { TokenBucketLimiter } from "../src/security/token-bucket-limiter";
import { OrderCreationRateLimitGuard } from "../src/security/order-creation-rate-limit.guard";

test("token buckets reject bursts and recover at the configured rate", () => {
  const limiter = new TokenBucketLimiter();
  assert.equal(limiter.consume("user", 2, 60, 0).allowed, true);
  assert.equal(limiter.consume("user", 2, 60, 0).allowed, true);
  const blocked = limiter.consume("user", 2, 60, 0);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(limiter.consume("user", 2, 60, 1_000).allowed, true);
});

test("authentication endpoints receive a stricter IP limit", () => {
  const middleware = new RequestRateLimitMiddleware(new TokenBucketLimiter());
  const request = {
    method: "POST",
    path: "/api/v1/auth/login",
    originalUrl: "/api/v1/auth/login",
    ip: "203.0.113.10",
    socket: {},
  } as never;
  let status = 0;
  let body: unknown;
  const headers = new Map<string, string>();
  const response = {
    setHeader: (name: string, value: string) => headers.set(name, value),
    status: (value: number) => {
      status = value;
      return response;
    },
    json: (value: unknown) => {
      body = value;
      return response;
    },
  } as never;
  let nextCalls = 0;
  for (let index = 0; index < 13; index++)
    middleware.use(request, response, () => nextCalls++);
  assert.equal(nextCalls, 12);
  assert.equal(status, 429);
  assert.equal((body as { statusCode: number }).statusCode, 429);
  assert.ok(Number(headers.get("Retry-After")) >= 1);
});

test("internal health checks remain available during traffic limiting", () => {
  const middleware = new RequestRateLimitMiddleware(new TokenBucketLimiter());
  let nextCalls = 0;
  for (const path of [
    "/api/v1/health",
    "/api/v1/health/ready",
    "/api/v1/metrics",
  ])
    middleware.use(
      {
        method: "GET",
        path,
        originalUrl: path,
        ip: "127.0.0.1",
        socket: {},
      } as never,
      {} as never,
      () => nextCalls++,
    );
  assert.equal(nextCalls, 3);
});

test("public health traffic cannot bypass the global limit", () => {
  const middleware = new RequestRateLimitMiddleware(new TokenBucketLimiter());
  const request = {
    method: "GET",
    path: "/api/v1/health",
    originalUrl: "/api/v1/health",
    ip: "198.51.100.20",
    socket: {},
  } as never;
  let status = 0;
  const response = {
    setHeader: () => undefined,
    status: (value: number) => {
      status = value;
      return response;
    },
    json: () => response,
  } as never;
  let nextCalls = 0;
  for (let index = 0; index < 181; index++)
    middleware.use(request, response, () => nextCalls++);
  assert.equal(nextCalls, 180);
  assert.equal(status, 429);
});

test("signed-in order creation is limited per account", () => {
  const guard = new OrderCreationRateLimitGuard(new TokenBucketLimiter());
  const headers = new Map<string, string>();
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ auth: { sub: "client-1" } }),
      getResponse: () => ({
        setHeader: (name: string, value: string) => headers.set(name, value),
      }),
    }),
  } as never;
  for (let index = 0; index < 5; index++)
    assert.equal(guard.canActivate(context), true);
  assert.throws(
    () => guard.canActivate(context),
    (error: unknown) => {
      return (error as { getStatus?: () => number }).getStatus?.() === 429;
    },
  );
  assert.ok(Number(headers.get("Retry-After")) >= 1);
});
