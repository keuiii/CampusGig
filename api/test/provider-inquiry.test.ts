import assert from "node:assert/strict";
import test from "node:test";
import { MessagesService } from "../src/modules/messages/messages.service";

test("starting a provider inquiry is idempotent per client and provider", async () => {
  let upsertInput: any;
  let participantUpdate: any;
  const updatedAt = new Date("2026-09-28T10:00:00Z");
  const createdAt = new Date("2026-09-28T10:01:00Z");
  const prisma = {
    user: {
      findFirst: async () => ({
        id: "provider-1",
        displayName: "Provider One",
        avatarPath: null,
        updatedAt,
      }),
    },
    conversation: {
      upsert: async (input: any) => {
        upsertInput = input;
        return { id: "conversation-1", createdAt };
      },
    },
    conversationParticipant: {
      update: async (input: any) => {
        participantUpdate = input;
        return {};
      },
    },
  };

  const result = await new MessagesService(
    prisma as never,
  ).startProviderInquiry("client-1", "provider-1");

  assert.deepEqual(upsertInput.where, {
    clientId_providerId: { clientId: "client-1", providerId: "provider-1" },
  });
  assert.equal(upsertInput.create.kind, "INQUIRY");
  assert.deepEqual(upsertInput.create.participants.create, [
    { userId: "client-1" },
    { userId: "provider-1" },
  ]);
  assert.deepEqual(participantUpdate.data, {
    hiddenAt: null,
    archivedAt: null,
  });
  assert.equal(result.data.kind, "INQUIRY");
  assert.equal(result.data.participant.id, "provider-1");
  assert.equal(result.data.order, null);
});

test("provider inquiries reject self-messaging and unavailable providers", async () => {
  const service = new MessagesService({
    user: { findFirst: async () => null },
  } as never);

  await assert.rejects(
    () => service.startProviderInquiry("same-user", "same-user"),
    /cannot message your own provider profile/i,
  );
  await assert.rejects(
    () => service.startProviderInquiry("client-1", "provider-1"),
    /Provider profile not found/,
  );
});

test("the inbox hides empty inquiries until their first message", async () => {
  let inboxSql = "";
  const service = new MessagesService({
    $queryRaw: async (query: { strings: string[] }) => {
      inboxSql = query.strings.join(" ");
      return [];
    },
  } as never);

  const result = await service.inbox("client-1");

  assert.match(inboxSql, /kind.*ORDER.*kind.*INQUIRY.*m\."id" IS NOT NULL/s);
  assert.deepEqual(result, {
    data: [],
    unreadCount: 0,
    pagination: { hasMore: false, nextCursor: null },
  });
});

test("generic conversation access remains participant-only", async () => {
  const prisma = {
    conversation: { findFirst: async () => null },
  };
  const service = new MessagesService(prisma as never);

  await assert.rejects(
    () => service.listConversation("outsider", "conversation-1"),
    /Conversation not found/,
  );
  await assert.rejects(
    () => service.sendConversation("outsider", "conversation-1", "Hello"),
    /Conversation not found/,
  );
});
