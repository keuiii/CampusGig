ALTER TABLE "Order"
ADD COLUMN "clientRequestId" UUID,
ADD COLUMN "requestFingerprint" TEXT;

CREATE UNIQUE INDEX "Order_clientId_clientRequestId_key"
ON "Order"("clientId", "clientRequestId");
