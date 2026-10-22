CREATE TYPE "ConversationKind" AS ENUM ('ORDER', 'INQUIRY');

ALTER TABLE "Conversation"
  ADD COLUMN "kind" "ConversationKind" NOT NULL DEFAULT 'ORDER',
  ADD COLUMN "clientId" UUID,
  ADD COLUMN "providerId" UUID,
  ALTER COLUMN "orderId" DROP NOT NULL;

ALTER TABLE "Notification"
  ADD COLUMN "conversationId" UUID;

CREATE UNIQUE INDEX "Conversation_clientId_providerId_key"
  ON "Conversation"("clientId", "providerId");
CREATE INDEX "Conversation_providerId_createdAt_idx"
  ON "Conversation"("providerId", "createdAt");
CREATE INDEX "Notification_conversationId_recipientId_readAt_idx"
  ON "Notification"("conversationId", "recipientId", "readAt");

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Conversation_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Conversation_context_check"
  CHECK (
    ("kind" = 'ORDER' AND "orderId" IS NOT NULL AND "clientId" IS NULL AND "providerId" IS NULL)
    OR
    ("kind" = 'INQUIRY' AND "orderId" IS NULL AND "clientId" IS NOT NULL AND "providerId" IS NOT NULL AND "clientId" <> "providerId")
  );

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
