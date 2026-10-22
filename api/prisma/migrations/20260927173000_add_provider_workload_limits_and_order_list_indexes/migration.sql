ALTER TABLE "ProviderProfile"
ADD COLUMN "maxActiveOrders" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "maxPendingOrders" INTEGER NOT NULL DEFAULT 50;

ALTER TABLE "ProviderProfile"
ADD CONSTRAINT "ProviderProfile_maxActiveOrders_check"
CHECK ("maxActiveOrders" BETWEEN 1 AND 20),
ADD CONSTRAINT "ProviderProfile_maxPendingOrders_check"
CHECK ("maxPendingOrders" BETWEEN 1 AND 100);

CREATE INDEX "Order_clientId_clientRemovedAt_clientArchivedAt_createdAt_id_idx"
ON "Order"("clientId", "clientRemovedAt", "clientArchivedAt", "createdAt", "id");

CREATE INDEX "Order_providerId_providerRemovedAt_providerArchivedAt_createdAt_id_idx"
ON "Order"("providerId", "providerRemovedAt", "providerArchivedAt", "createdAt", "id");
