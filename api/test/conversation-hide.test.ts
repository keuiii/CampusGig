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
