import assert from "node:assert/strict";
import test from "node:test";
import { MessagesGateway } from "../src/modules/messages/messages.gateway";

test("realtime subscriptions require an order participant", async () => {
  const joined: string[] = [];
  const socket = {
    data: { auth: { sub: "user-1" } },
    join: async (room: string) => { joined.push(room); },
  };
  const prisma = { conversation: { count: async () => 1 } };
  const gateway = new MessagesGateway({} as never, {} as never, prisma as never);

  assert.deepEqual(await gateway.subscribe(socket as never, { orderId: "order-1" }), { ok: true });
  assert.deepEqual(joined, ["order:order-1"]);
});

test("realtime subscriptions reject users outside the order", async () => {
  const socket = { data: { auth: { sub: "outsider" } }, join: async () => assert.fail("must not join") };
  const prisma = { conversation: { count: async () => 0 } };
  const gateway = new MessagesGateway({} as never, {} as never, prisma as never);

  assert.deepEqual(await gateway.subscribe(socket as never, { orderId: "order-1" }), { ok: false });
});
