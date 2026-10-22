-- Phase D adds immutable, versioned delivery evidence without rewriting order,
-- payment, deadline, pricing, or private-storage identities.
CREATE TYPE "DeliveryFileAccessType" AS ENUM ('ACCESS_GRANTED');

CREATE TABLE "DeliverySubmission" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "note" TEXT,
    "clientRequestId" UUID,
    "requestFingerprint" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliverySubmission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeliverySubmission_version_positive" CHECK ("version" > 0),
    CONSTRAINT "DeliverySubmission_idempotency_complete" CHECK (
        ("clientRequestId" IS NULL AND "requestFingerprint" IS NULL)
        OR ("clientRequestId" IS NOT NULL AND "requestFingerprint" IS NOT NULL)
    )
);

ALTER TABLE "OrderFile"
ADD COLUMN "deliverySubmissionId" UUID;

-- Existing application transactions inserted delivery/revision files first and
-- their provider SUBMITTED history event immediately afterward. Associate only
-- files for which that server-authored event is present; unmatched legacy rows
-- deliberately remain unversioned rather than receiving fabricated evidence.
WITH "mappedFiles" AS (
    SELECT
        file."id" AS "fileId",
        submission_event."id" AS "historyId"
    FROM "OrderFile" AS file
    JOIN "Order" AS orders
      ON orders."id" = file."orderId"
    JOIN LATERAL (
        SELECT history."id"
        FROM "OrderStatusHistory" AS history
        WHERE history."orderId" = file."orderId"
          AND history."toStatus" = 'SUBMITTED'
          AND history."changedBy" = orders."providerId"
          AND history."createdAt" >= file."createdAt"
        ORDER BY history."createdAt" ASC, history."id" ASC
        LIMIT 1
    ) AS submission_event ON TRUE
    WHERE file."purpose" IN ('DELIVERABLE', 'REVISION')
),
"eligibleHistory" AS (
    SELECT DISTINCT "historyId"
    FROM "mappedFiles"
),
"rankedHistory" AS (
    SELECT
        history."id" AS "historyId",
        history."orderId",
        history."changedBy" AS "providerId",
        ROW_NUMBER() OVER (
            PARTITION BY history."orderId"
            ORDER BY history."createdAt" ASC, history."id" ASC
        )::INTEGER AS "version",
        history."note",
        history."createdAt" AS "submittedAt"
    FROM "OrderStatusHistory" AS history
    JOIN "eligibleHistory" AS eligible
      ON eligible."historyId" = history."id"
)
INSERT INTO "DeliverySubmission" (
    "id",
    "orderId",
    "providerId",
    "version",
    "note",
    "submittedAt",
    "createdAt"
)
SELECT
    md5('campusgig-delivery-submission:' || ranked."historyId"::text)::UUID,
    ranked."orderId",
    ranked."providerId",
    ranked."version",
    ranked."note",
    ranked."submittedAt",
    ranked."submittedAt"
FROM "rankedHistory" AS ranked;

WITH "mappedFiles" AS (
    SELECT
        file."id" AS "fileId",
        submission_event."id" AS "historyId"
    FROM "OrderFile" AS file
    JOIN "Order" AS orders
      ON orders."id" = file."orderId"
    JOIN LATERAL (
        SELECT history."id"
        FROM "OrderStatusHistory" AS history
        WHERE history."orderId" = file."orderId"
          AND history."toStatus" = 'SUBMITTED'
          AND history."changedBy" = orders."providerId"
          AND history."createdAt" >= file."createdAt"
        ORDER BY history."createdAt" ASC, history."id" ASC
        LIMIT 1
    ) AS submission_event ON TRUE
    WHERE file."purpose" IN ('DELIVERABLE', 'REVISION')
)
UPDATE "OrderFile" AS file
SET "deliverySubmissionId" =
    md5('campusgig-delivery-submission:' || mapped."historyId"::text)::UUID
FROM "mappedFiles" AS mapped
WHERE file."id" = mapped."fileId";

CREATE TABLE "DeliveryFileAccessAudit" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "deliverySubmissionId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "accessType" "DeliveryFileAccessType" NOT NULL DEFAULT 'ACCESS_GRANTED',
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryFileAccessAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliverySubmission_orderId_version_key"
ON "DeliverySubmission"("orderId", "version");

CREATE UNIQUE INDEX "DeliverySubmission_orderId_clientRequestId_key"
ON "DeliverySubmission"("orderId", "clientRequestId");

CREATE INDEX "DeliverySubmission_providerId_submittedAt_idx"
ON "DeliverySubmission"("providerId", "submittedAt");

CREATE INDEX "OrderFile_deliverySubmissionId_idx"
ON "OrderFile"("deliverySubmissionId");

CREATE INDEX "DeliveryFileAccessAudit_orderId_accessedAt_idx"
ON "DeliveryFileAccessAudit"("orderId", "accessedAt");

CREATE INDEX "DeliveryFileAccessAudit_deliverySubmissionId_accessedAt_idx"
ON "DeliveryFileAccessAudit"("deliverySubmissionId", "accessedAt");

CREATE INDEX "DeliveryFileAccessAudit_fileId_accessedAt_idx"
ON "DeliveryFileAccessAudit"("fileId", "accessedAt");

CREATE INDEX "DeliveryFileAccessAudit_userId_accessedAt_idx"
ON "DeliveryFileAccessAudit"("userId", "accessedAt");

ALTER TABLE "OrderFile"
ADD CONSTRAINT "OrderFile_checksum_sha256" CHECK (
    "checksum" IS NULL OR "checksum" ~ '^[0-9a-f]{64}$'
);

COMMENT ON COLUMN "OrderFile"."checksum" IS
'Server-generated lowercase SHA-256 for committed delivery evidence; null for historical or non-delivery files.';

ALTER TABLE "DeliverySubmission"
ADD CONSTRAINT "DeliverySubmission_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliverySubmission"
ADD CONSTRAINT "DeliverySubmission_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderFile"
ADD CONSTRAINT "OrderFile_deliverySubmissionId_fkey"
FOREIGN KEY ("deliverySubmissionId") REFERENCES "DeliverySubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeliveryFileAccessAudit"
ADD CONSTRAINT "DeliveryFileAccessAudit_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryFileAccessAudit"
ADD CONSTRAINT "DeliveryFileAccessAudit_deliverySubmissionId_fkey"
FOREIGN KEY ("deliverySubmissionId") REFERENCES "DeliverySubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryFileAccessAudit"
ADD CONSTRAINT "DeliveryFileAccessAudit_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "OrderFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryFileAccessAudit"
ADD CONSTRAINT "DeliveryFileAccessAudit_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
