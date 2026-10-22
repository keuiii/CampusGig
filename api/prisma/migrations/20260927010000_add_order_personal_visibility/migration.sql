ALTER TABLE "Order"
    ADD COLUMN "clientArchivedAt" TIMESTAMP(3),
    ADD COLUMN "clientRemovedAt" TIMESTAMP(3),
    ADD COLUMN "providerArchivedAt" TIMESTAMP(3),
    ADD COLUMN "providerRemovedAt" TIMESTAMP(3);
