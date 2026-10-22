import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";

const user = {
  id: "user-1",
  email: "student@example.com",
  displayName: "Campus Student",
  hasAvatar: false,
  status: "ACTIVE" as const,
  roles: ["CLIENT" as const],
};

const activeSession = () => ({
  id: "session-1",
  sessionVersion: 1,
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  user: {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarPath: null,
    status: "ACTIVE",
    sessionVersion: 1,
    roles: [{ role: "CLIENT" }],
  },
});

test("new sessions store only a hash and bind access tokens to the session", async () => {
  let storedHash = "";
  let signedPayload: Record<string, unknown> = {};
  const service = new AuthSessionService(
    {
      user: { findUniqueOrThrow: async () => ({ sessionVersion: 4 }) },
      authSession: {
        create: async ({ data }: any) => {
          storedHash = data.refreshTokens.create.tokenHash;
          return { id: "session-1" };
        },
      },
    } as never,
    {
      signAsync: async (payload: Record<string, unknown>) => {
        signedPayload = payload;
        return "access-token";
      },
    } as never,
    { get: () => undefined, getOrThrow: () => "test-secret" } as never,
  );

  const result = await service.create(user, {
    clientType: "MOBILE",
    deviceName: "Pixel 9",
  });
  assert.equal(result.accessToken, "access-token");
  assert.equal(result.refreshToken.length > 40, true);
  assert.equal(storedHash.length, 64);
  assert.notEqual(storedHash, result.refreshToken);
  assert.equal(signedPayload.sid, "session-1");
  assert.equal(signedPayload.sessionVersion, 4);
});

test("reuse of a consumed refresh token revokes its entire family", async () => {
  let revokedSession = 0;
  let revokedTokens = 0;
  const disconnectedSessions: string[] = [];
  const database = {
    refreshToken: {
      findUnique: async () => ({
        id: "token-1",
        usedAt: new Date(Date.now() - 120_000),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        session: activeSession(),
      }),
      updateMany: async () => {
        revokedTokens += 1;
        return { count: 1 };
      },
    },
    authSession: {
      updateMany: async () => {
        revokedSession += 1;
        return { count: 1 };
      },
    },
  };
  const service = new AuthSessionService(
    { $transaction: async (action: any) => action(database) } as never,
    {} as never,
    { get: () => undefined, getOrThrow: () => "test-secret" } as never,
    {
      disconnectSession: (sessionId: string) =>
        disconnectedSessions.push(sessionId),
    } as never,
  );

  await assert.rejects(
    () => service.refresh("replayed-token"),
    UnauthorizedException,
  );
  assert.equal(revokedSession, 1);
  assert.equal(revokedTokens, 1);
  assert.deepEqual(disconnectedSessions, ["session-1"]);
});

test("a recent duplicate refresh replays the same successor without revoking the session", async () => {
  let lookupCount = 0;
  let revokedSession = 0;
  let revokedTokens = 0;
  const successorExpiry = new Date(Date.now() + 60_000);
  const database = {
    refreshToken: {
      findUnique: async () => {
        lookupCount += 1;
        if (lookupCount === 1)
          return {
            id: "token-1",
            usedAt: new Date(Date.now() - 1_000),
            revokedAt: null,
            expiresAt: successorExpiry,
            session: activeSession(),
          };
        return {
          sessionId: "session-1",
          expiresAt: successorExpiry,
          revokedAt: null,
        };
      },
      updateMany: async () => {
        revokedTokens += 1;
        return { count: 1 };
      },
    },
    authSession: {
      updateMany: async () => {
        revokedSession += 1;
        return { count: 1 };
      },
    },
  };
  const service = new AuthSessionService(
    { $transaction: async (action: any) => action(database) } as never,
    { signAsync: async () => "access-token" } as never,
    { get: () => undefined, getOrThrow: () => "test-secret" } as never,
  );

  const result = await service.refresh("recently-consumed-token");

  assert.equal(result.accessToken, "access-token");
  assert.equal(result.refreshToken.length > 40, true);
  assert.equal(lookupCount, 2);
  assert.equal(revokedSession, 0);
  assert.equal(revokedTokens, 0);
});

test("the losing side of a concurrent refresh replays the committed successor", async () => {
  let revokedSession = 0;
  let revokedTokens = 0;
  let initialTokenRead = false;
  const successorExpiry = new Date(Date.now() + 60_000);
  const database = {
    refreshToken: {
      findUnique: async ({ where }: any) => {
        if (where.id)
          return { usedAt: new Date(Date.now() - 100), revokedAt: null };
        if (where.tokenHash && !initialTokenRead)
          return {
            id: "token-1",
            usedAt: null,
            revokedAt: null,
            expiresAt: successorExpiry,
            session: activeSession(),
          };
        return {
          sessionId: "session-1",
          expiresAt: successorExpiry,
          revokedAt: null,
        };
      },
      updateMany: async ({ data }: any) => {
        if (data.usedAt) {
          initialTokenRead = true;
          return { count: 0 };
        }
        revokedTokens += 1;
        return { count: 1 };
      },
    },
    authSession: {
      updateMany: async () => {
        revokedSession += 1;
        return { count: 1 };
      },
    },
  };
  const service = new AuthSessionService(
    { $transaction: async (action: any) => action(database) } as never,
    { signAsync: async () => "access-token" } as never,
    { get: () => undefined, getOrThrow: () => "test-secret" } as never,
  );

  const result = await service.refresh("concurrent-token");

  assert.equal(result.accessToken, "access-token");
  assert.equal(result.refreshToken.length > 40, true);
  assert.equal(revokedSession, 0);
  assert.equal(revokedTokens, 0);
});

test("single-session and global revocation target the correct active sockets", async () => {
  const disconnectedSessions: string[] = [];
  const disconnectedUsers: string[] = [];
  const database = {
    authSession: {
      updateMany: async () => ({ count: 1 }),
      findMany: async () => [{ id: "session-a" }, { id: "session-b" }],
    },
    refreshToken: { updateMany: async () => ({ count: 1 }) },
    user: { update: async () => ({}) },
  };
  const service = new AuthSessionService(
    { $transaction: async (action: any) => action(database) } as never,
    {} as never,
    { get: () => undefined } as never,
    {
      disconnectSession: (sessionId: string) =>
        disconnectedSessions.push(sessionId),
      disconnectUser: (userId: string) => disconnectedUsers.push(userId),
    } as never,
  );

  await service.revoke("user-1", "session-a");
  assert.deepEqual(disconnectedSessions, ["session-a"]);
  assert.deepEqual(disconnectedUsers, []);

  await service.revokeAll("user-1");
  assert.deepEqual(disconnectedUsers, ["user-1"]);
});

test("active session listing uses the current security generation and marks the caller", async () => {
  let receivedWhere:
    | {
        userId?: string;
        sessionVersion?: number;
        revokedAt?: null;
        expiresAt?: { gt?: Date };
      }
    | undefined;
  const service = new AuthSessionService(
    {
      user: {
        findUniqueOrThrow: async () => ({ sessionVersion: 7 }),
      },
      authSession: {
        findMany: async ({ where }: { where: typeof receivedWhere }) => {
          receivedWhere = where;
          return [
            {
              id: "session-current",
              clientType: "MOBILE",
              deviceName: "Pixel 9",
              createdAt: new Date("2026-09-24T00:00:00Z"),
              lastUsedAt: new Date("2026-09-24T01:00:00Z"),
              expiresAt: new Date("2026-10-24T00:00:00Z"),
            },
            {
              id: "session-web",
              clientType: "WEB",
              deviceName: "Windows browser",
              createdAt: new Date("2026-09-23T00:00:00Z"),
              lastUsedAt: new Date("2026-09-23T01:00:00Z"),
              expiresAt: new Date("2026-10-23T00:00:00Z"),
            },
          ];
        },
      },
    } as never,
    {} as never,
    { get: () => undefined } as never,
  );

  const result = await service.list("user-1", "session-current");

  assert.equal(receivedWhere?.userId, "user-1");
  assert.equal(receivedWhere?.sessionVersion, 7);
  assert.equal(receivedWhere?.revokedAt, null);
  assert.ok(receivedWhere?.expiresAt?.gt instanceof Date);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].current, true);
  assert.equal(result.data[1].current, false);
});

test("database and browser contracts protect refresh credentials", async () => {
  const [migration, controller, browserPage] = await Promise.all([
    readFile(
      "prisma/migrations/20260913100000_add_rotating_auth_sessions/migration.sql",
      "utf8",
    ),
    readFile("src/modules/auth/auth.controller.ts", "utf8"),
    readFile("../app/page.tsx", "utf8"),
  ]);
  assert.match(migration, /CREATE TABLE "AuthSession"/);
  assert.match(migration, /"tokenHash" TEXT NOT NULL/);
  assert.match(controller, /httpOnly: true/);
  assert.match(controller, /sameSite: "strict"/);
  assert.doesNotMatch(
    browserPage,
    /localStorage\.setItem\("campusgig\.webToken"/,
  );
});
