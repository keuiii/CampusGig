import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { JwtAuthGuard } from "../src/modules/auth/jwt-auth.guard";

function context(request: {
  headers: { authorization?: string };
  auth?: unknown;
}) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

function guard(
  status: string,
  storedVersion: number,
  tokenVersion = 3,
  sessionId?: string,
  sessionActive = true,
  storedRoles = ["CLIENT"],
) {
  return new JwtAuthGuard(
    {
      verifyAsync: async () => ({
        sub: "user-1",
        email: "student@example.com",
        roles: ["CLIENT"],
        sessionVersion: tokenVersion,
        ...(sessionId ? { sid: sessionId } : {}),
      }),
    } as never,
    { getOrThrow: () => "test-secret" } as never,
    {
      user: {
        findUnique: async () => ({
          status,
          sessionVersion: storedVersion,
          roles: storedRoles.map((role) => ({ role })),
        }),
      },
      authSession: {
        findFirst: async () => (sessionActive ? { id: sessionId } : null),
      },
    } as never,
  );
}

test("active sessions require the current server-side session version", async () => {
  const request = { headers: { authorization: "Bearer valid-token" } };
  assert.equal(
    await guard("ACTIVE", 3).canActivate(context(request) as never),
    true,
  );
  assert.equal((request as any).auth.sessionVersion, 3);
});

test("active sessions use authoritative roles granted after token issuance", async () => {
  const request = { headers: { authorization: "Bearer valid-token" } };
  assert.equal(
    await guard("ACTIVE", 3, 3, undefined, true, [
      "CLIENT",
      "STUDENT",
      "PROVIDER",
    ]).canActivate(context(request) as never),
    true,
  );
  assert.deepEqual((request as any).auth.roles, [
    "CLIENT",
    "STUDENT",
    "PROVIDER",
  ]);
});

test("rotated access tokens require a non-revoked server-side session", async () => {
  const request = { headers: { authorization: "Bearer session-token" } };
  assert.equal(
    await guard("ACTIVE", 3, 3, "session-1").canActivate(
      context(request) as never,
    ),
    true,
  );
  await assert.rejects(
    () =>
      guard("ACTIVE", 3, 3, "session-1", false).canActivate(
        context({
          headers: { authorization: "Bearer revoked-token" },
        }) as never,
      ),
    UnauthorizedException,
  );
});

test("password changes revoke previously issued access tokens", async () => {
  await assert.rejects(
    () =>
      guard("ACTIVE", 4, 3).canActivate(
        context({ headers: { authorization: "Bearer old-token" } }) as never,
      ),
    UnauthorizedException,
  );
});

test("suspended accounts are rejected even when the token signature is valid", async () => {
  await assert.rejects(
    () =>
      guard("SUSPENDED", 3).canActivate(
        context({ headers: { authorization: "Bearer signed-token" } }) as never,
      ),
    UnauthorizedException,
  );
});
