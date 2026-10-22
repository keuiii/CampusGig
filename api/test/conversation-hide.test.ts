import assert from "node:assert/strict";
import test from "node:test";
import { MessagesService } from "../src/modules/messages/messages.service";

test("hiding a conversation affects only the requesting participant", async () => {
  let updateInput: any;
  const prisma = {
    conversationParticipant: {
      findUnique: async () => ({ conversationId: "conversation-1" }),
      update: async (input: unknown) => {
        updateInput = input;
        return {};
      },
    },
  };

  const service = new MessagesService(prisma as never);
  const result = await service.hideConversation("user-1", "conversation-1");

  assert.deepEqual(updateInput.where, {
    conversationId_userId: {
      conversationId: "conversation-1",
      userId: "user-1",
    },
  });
  assert.ok(updateInput.data.hiddenAt instanceof Date);
  assert.equal(updateInput.data.pinnedAt, null);
  assert.equal(updateInput.data.archivedAt, null);
  assert.equal(result.message, "Conversation removed from Messages");
});

test("hiding a conversation rejects non-participants", async () => {
  const prisma = {
    conversationParticipant: {
      findUnique: async () => null,
    },
  };

  const service = new MessagesService(prisma as never);
  await assert.rejects(
    () => service.hideConversation("outsider", "conversation-1"),
    /Conversation not found/,
  );
});

test("pinning a conversation persists only for the requesting participant", async () => {
  let updateInput: any;
  const prisma = {
    conversationParticipant: {
      findUnique: async () => ({ conversationId: "conversation-1" }),
      update: async (input: any) => {
        updateInput = input;
        return { pinnedAt: input.data.pinnedAt, archivedAt: null };
      },
    },
  };

  const service = new MessagesService(prisma as never);
  const result = await service.updateConversationPreferences(
    "user-1",
    "conversation-1",
    { pinned: true },
  );

  assert.deepEqual(updateInput.where, {
    conversationId_userId: {
      conversationId: "conversation-1",
      userId: "user-1",
    },
  });
  assert.ok(updateInput.data.pinnedAt instanceof Date);
  assert.equal(updateInput.data.archivedAt, undefined);
  assert.deepEqual(result.data, { isPinned: true, isArchived: false });
});

test("archiving a conversation also clears its pinned state", async () => {
  let updateInput: any;
  const prisma = {
    conversationParticipant: {
      findUnique: async () => ({ conversationId: "conversation-1" }),
      update: async (input: any) => {
        updateInput = input;
        return { pinnedAt: null, archivedAt: input.data.archivedAt };
      },
    },
  };

  const service = new MessagesService(prisma as never);
  const result = await service.updateConversationPreferences(
    "user-1",
    "conversation-1",
    { archived: true },
  );

  assert.ok(updateInput.data.archivedAt instanceof Date);
  assert.equal(updateInput.data.pinnedAt, null);
  assert.deepEqual(result.data, { isPinned: false, isArchived: true });
});

test("conversation preferences reject empty updates and non-participants", async () => {
  const prisma = {
    conversationParticipant: {
      findUnique: async () => null,
    },
  };
  const service = new MessagesService(prisma as never);

  await assert.rejects(
    () => service.updateConversationPreferences("user-1", "conversation-1", {}),
    /Choose a conversation preference/,
  );
  await assert.rejects(
    () => service.updateConversationPreferences("user-1", "conversation-1", { pinned: true }),
    /Conversation not found/,
  );
});
