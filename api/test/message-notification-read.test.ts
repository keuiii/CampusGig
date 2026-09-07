import assert from "node:assert/strict";
import test from "node:test";
import { MessagesService } from "../src/modules/messages/messages.service";

test("opening an order conversation marks only its unread message notifications as read", async () => {
  let notificationUpdate: any;
  const prisma = {
    conversation: {
      findFirst: async () => ({
        id: "conversation-1",
        order: {
          clientId: "user-1",
          providerId: "user-2",
          titleSnapshot: "Logo Design",
        },
      }),
    },
    message: { findMany: async () => [] },
    conversationParticipant: { update: async () => ({}) },
    notification: {
      updateMany: async (input: unknown) => {
        notificationUpdate = input;
        return { count: 2 };
      },
    },
  };

  const service = new MessagesService(prisma as never);
  await service.list("user-1", "order-1");

  assert.deepEqual(notificationUpdate.where, {
    recipientId: "user-1",
    orderId: "order-1",
    type: "NEW_MESSAGE",
    readAt: null,
  });
  assert.ok(notificationUpdate.data.readAt instanceof Date);
});
