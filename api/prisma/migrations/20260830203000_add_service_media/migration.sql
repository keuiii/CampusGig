CREATE TYPE "ServiceMediaKind" AS ENUM ('COVER', 'PORTFOLIO');

CREATE TABLE "ServiceMedia" (
  "id" UUID NOT NULL,
  "serviceId" UUID NOT NULL,
  "kind" "ServiceMediaKind" NOT NULL,
  "storagePath" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceMedia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceMedia_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ServiceMedia_storagePath_key" ON "ServiceMedia"("storagePath");
CREATE INDEX "ServiceMedia_serviceId_kind_sortOrder_idx" ON "ServiceMedia"("serviceId", "kind", "sortOrder");
