import assert from "node:assert/strict";
import test from "node:test";
import { MessagesGateway } from "../src/modules/messages/messages.gateway";
import { SocketSessionRegistry } from "../src/modules/auth/socket-session-registry.service";

const validAuth = () => ({
  sub: "user-1",
  sid: "session-1",
  sessionVersion: 2,
  exp: Math.floor(Date.now() / 1000) + 300,
});

const validSessionPrisma = (extra: Record<string, unknown> = {}) => ({
  user: {
    findUnique: async () => ({ status: "ACTIVE", sessionVersion: 2 }),
  },
  authSession: { findFirst: async () => ({ id: "session-1" }) },
  ...extra,
});

test("realtime subscriptions require an order participant", async () => {
  const joined: string[] = [];
  const socket = {
    data: { auth: validAuth() },
    join: async (room: string) => {
      joined.push(room);
    },
  };
  const prisma = validSessionPrisma({
    conversation: {
      findFirst: async () => ({ id: "conversation-1", orderId: "order-1" }),
    },
  });
  const gateway = new MessagesGateway(
    {} as never,
    {} as never,
    prisma as never,
    {} as never,
  );

  assert.deepEqual(
    await gateway.subscribe(socket as never, { orderId: "order-1" }),
    { ok: true },
  );
  assert.deepEqual(joined, ["conversation:conversation-1", "order:order-1"]);
});

test("realtime subscriptions reject users outside the order", async () => {
  const socket = {
    data: { auth: { ...validAuth(), sub: "outsider" } },
    join: async () => assert.fail("must not join"),
  };
  const prisma = validSessionPrisma({
    conversation: { findFirst: async () => null },
  });
  const gateway = new MessagesGateway(
    {} as never,
    {} as never,
    prisma as never,
    {} as never,
  );

  assert.deepEqual(
    await gateway.subscribe(socket as never, { orderId: "order-1" }),
    { ok: false },
  );
});

test("authenticated users can subscribe to active provider statistics", async () => {
  const joined: string[] = [];
  const socket = {
    data: { auth: validAuth() },
    join: async (room: string) => joined.push(room),
  };
  const prisma = validSessionPrisma();
  prisma.user.count = async () => 1;
  const gateway = new MessagesGateway(
    {} as never,
    {} as never,
    prisma as never,
    {} as never,
  );

  assert.deepEqual(
    await gateway.subscribeProvider(socket as never, {
      providerId: "provider-1",
    }),
    { ok: true },
  );
  assert.deepEqual(joined, ["provider:provider-1"]);
});

test("revoked sessions cannot join a private order room", async () => {
  let joined = false;
  const socket = {
    data: { auth: validAuth() },
    join: async () => {
      joined = true;
    },
  };
  const prisma = validSessionPrisma({
    authSession: { findFirst: async () => null },
    conversation: { count: async () => 1 },
  });
  const gateway = new MessagesGateway(
    {} as never,
    {} as never,
    prisma as never,
    {} as never,
  );

  assert.deepEqual(
    await gateway.subscribe(socket as never, { orderId: "order-1" }),
    { ok: false },
  );
  assert.equal(joined, false);
});

test("session registry invalidates only the revoked session and cleans indexes", () => {
  const registry = new SocketSessionRegistry();
  const disconnected: string[] = [];
  const socket = (id: string) => ({
    id,
    emit: () => undefined,
    disconnect: () => disconnected.push(id),
  });
  const expiry = new Date(Date.now() + 60_000);
  registry.register(socket("socket-a") as never, "user-1", "session-a", expiry);
  registry.register(socket("socket-b") as never, "user-1", "session-b", expiry);

  registry.disconnectSession("session-a");

  assert.deepEqual(disconnected, ["socket-a"]);
  assert.deepEqual(registry.counts(), { sockets: 1, sessions: 1, users: 1 });
  registry.disconnectUser("user-1");
  assert.deepEqual(disconnected, ["socket-a", "socket-b"]);
  assert.deepEqual(registry.counts(), { sockets: 0, sessions: 0, users: 0 });
});

test("valid session-bound tokens connect and use only their authenticated user room", async () => {
  const joined: string[] = [];
  let registered: unknown;
  const socket = {
    id: "socket-1",
    data: {},
    handshake: { auth: { token: "valid-token" } },
    join: async (room: string) => joined.push(room),
    emit: () => undefined,
    disconnect: () => assert.fail("valid socket must remain connected"),
  };
  const registry = {
    register: (...args: unknown[]) => {
      registered = args.slice(1);
    },
    unregister: () => undefined,
  };
  const gateway = new MessagesGateway(
    { verifyAsync: async () => validAuth() } as never,
    { getOrThrow: () => "secret" } as never,
    validSessionPrisma() as never,
    registry as never,
  );

  await gateway.handleConnection(socket as never);

  assert.deepEqual(joined, ["user:user-1", "marketplace"]);
  assert.deepEqual(registered, [
    "user-1",
    "session-1",
    new Date(validAuth().exp * 1000),
  ]);
  gateway.handleDisconnect(socket as never);
});

test("realtime connection floods are rejected before authentication or database work", async () => {
  let verified = false;
  let disconnected = false;
  let errorMessage = "";
  const gateway = new MessagesGateway(
    {
      verifyAsync: async () => {
        verified = true;
        return validAuth();
      },
    } as never,
    { getOrThrow: () => "secret" } as never,
    {} as never,
    {} as never,
    {
      consume: () => ({ allowed: false, remaining: 0, retryAfterSeconds: 1 }),
    } as never,
  );
  await gateway.handleConnection({
    id: "flooded-socket",
    data: {},
    handshake: {
      address: "203.0.113.25",
      auth: { token: "token" },
      headers: {},
    },
    emit: (_event: string, payload: { message: string }) => {
      errorMessage = payload.message;
    },
    disconnect: () => {
      disconnected = true;
    },
  } as never);
  assert.equal(verified, false);
  assert.equal(disconnected, true);
  assert.match(errorMessage, /too many realtime connections/i);
});

test("invalid tokens and suspended accounts are rejected on connection", async () => {
  for (const scenario of ["invalid-token", "suspended"] as const) {
    let disconnected = false;
    const socket = {
      id: scenario,
      data: {},
      handshake: { auth: { token: "token" } },
      join: async () => assert.fail("invalid socket must not join"),
      emit: () => undefined,
      disconnect: () => {
        disconnected = true;
      },
    };
    const gateway = new MessagesGateway(
      {
        verifyAsync: async () => {
          if (scenario === "invalid-token") throw new Error("invalid");
          return validAuth();
        },
      } as never,
      { getOrThrow: () => "secret" } as never,
      {
        user: {
          findUnique: async () => ({ status: "SUSPENDED", sessionVersion: 2 }),
        },
      } as never,
      {} as never,
    );

    await gateway.handleConnection(socket as never);
    assert.equal(disconnected, true);
  }
});

test("token expiry disconnects a registered socket and removes tracking", async () => {
  const registry = new SocketSessionRegistry();
  let reason = "";
  let disconnected = false;
  const socket = {
    id: "expired-socket",
    emit: (_name: string, payload: { reason: string }) => {
      reason = payload.reason;
    },
    disconnect: () => {
      disconnected = true;
    },
  };
  registry.register(
    socket as never,
    "user-1",
    "session-1",
    new Date(Date.now() - 1),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(disconnected, true);
  assert.equal(reason, "token_expired");
  assert.deepEqual(registry.counts(), { sockets: 0, sessions: 0, users: 0 });
});

test("provider statistic changes are emitted only to provider subscribers", () => {
  let room = "";
  let event: unknown;
  const gateway = new MessagesGateway({} as never, {} as never, {} as never);
  gateway.server = {
    to: (value: string) => {
      room = value;
      return {
        emit: (name: string, payload: unknown) => {
          event = { name, payload };
        },
      };
    },
  } as never;

  gateway.publishProviderStats("provider-1", "review");

  assert.equal(room, "provider:provider-1");
  assert.deepEqual(event, {
    name: "provider:stats-changed",
    payload: { providerId: "provider-1", reason: "review" },
  });
});

test("provider profile changes notify the account and public provider rooms", () => {
  const emissions: { room: string; name: string; payload: unknown }[] = [];
  const gateway = new MessagesGateway({} as never, {} as never, {} as never);
  gateway.server = {
    to: (room: string) => ({
      emit: (name: string, payload: unknown) =>
        emissions.push({ room, name, payload }),
    }),
  } as never;

  gateway.publishAccountChanged("provider-1", "provider-profile");

  assert.deepEqual(emissions, [
    {
      room: "user:provider-1",
      name: "account:changed",
      payload: { userId: "provider-1", resource: "provider-profile" },
    },
    {
      room: "provider:provider-1",
      name: "provider:profile-changed",
      payload: { providerId: "provider-1" },
    },
  ]);
});

test("order changes are emitted only to its room and participant user rooms", () => {
  const emissions: { room: string; name: string; payload: unknown }[] = [];
  const gateway = new MessagesGateway({} as never, {} as never, {} as never);
  gateway.server = {
    to: (room: string) => ({
      emit: (name: string, payload: unknown) =>
        emissions.push({ room, name, payload }),
    }),
  } as never;

  gateway.publishOrderChanged(
    "order-1",
    ["client-1", "provider-1"],
    "accepted",
  );

  assert.deepEqual(
    emissions
      .filter((item) => item.name === "order:changed")
      .map((item) => item.room),
    ["order:order-1", "user:client-1", "user:provider-1"],
  );
  assert.equal(
    emissions.some((item) => item.room === "marketplace"),
    false,
  );
});

test("marketplace changes contain only public resource identifiers", () => {
  let emission: unknown;
  const gateway = new MessagesGateway({} as never, {} as never, {} as never);
  gateway.server = {
    to: (room: string) => ({
      emit: (name: string, payload: unknown) => {
        emission = { room, name, payload };
      },
    }),
  } as never;

  gateway.publishMarketplaceChanged("service", "service-1");
  assert.deepEqual(emission, {
    room: "marketplace",
    name: "marketplace:changed",
    payload: { resource: "service", resourceId: "service-1" },
  });
});
