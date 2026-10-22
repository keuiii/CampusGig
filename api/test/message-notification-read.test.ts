import assert from "node:assert/strict";
import test from "node:test";
import { MessagesService } from "../src/modules/messages/messages.service";

test("opening an order conversation marks only its unread message notifications as read", async () => {
  let notificationUpdate: any;
  const prisma = {
    conversation: {
      findFirst: async () => ({
        id: "conversation-1",
        orderId: "order-1",
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
    type: "NEW_MESSAGE",
    readAt: null,
    OR: [{ conversationId: "conversation-1" }, { orderId: "order-1" }],
  });
  assert.ok(notificationUpdate.data.readAt instanceof Date);
});

test("conversation loading requests the newest bounded page and exposes an older-page cursor", async () => {
  let messageQuery: any;
  const sender = {
    id: "user-2",
    displayName: "Provider",
    avatarPath: null,
    updatedAt: new Date(),
  };
  const prisma = {
    conversation: {
      findFirst: async () => ({
        id: "conversation-1",
        orderId: "order-1",
        order: {
          clientId: "user-1",
          providerId: "user-2",
          titleSnapshot: "Logo Design",
        },
      }),
    },
    message: {
      findMany: async (query: unknown) => {
        messageQuery = query;
        return [
          {
            id: "message-3",
            createdAt: new Date("2026-09-10T03:00:00Z"),
            body: "Newest",
            senderId: "user-2",
            sender,
            attachments: [],
          },
          {
            id: "message-2",
            createdAt: new Date("2026-09-10T02:00:00Z"),
            body: "Older",
            senderId: "user-2",
            sender,
            attachments: [],
          },
        ];
      },
    },
    conversationParticipant: { update: async () => ({}) },
    notification: { updateMany: async () => ({ count: 0 }) },
  };

  const result = await new MessagesService(prisma as never).list(
    "user-1",
    "order-1",
    {
      before: "message-4",
      limit: 2,
    },
  );

  assert.deepEqual(messageQuery.orderBy, [
    { createdAt: "desc" },
    { id: "desc" },
  ]);
  assert.deepEqual(messageQuery.cursor, { id: "message-4" });
  assert.equal(messageQuery.skip, 1);
  assert.equal(messageQuery.take, 2);
  assert.deepEqual(
    result.data.map((message) => message.id),
    ["message-2", "message-3"],
  );
  assert.equal(result.page.nextCursor, "message-2");
});
