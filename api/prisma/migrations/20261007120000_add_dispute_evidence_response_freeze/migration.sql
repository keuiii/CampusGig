-- Phase H adds evidence-backed, time-bounded disputes and immutable earning
-- freeze provenance. Historical disputes remain unchanged; nullable workflow
-- fields are intentionally not backfilled without authoritative evidence.

ALTER TABLE "OrderDispute"
ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "DisputeStatus_phase_h" AS ENUM (
    'OPEN',
    'WAITING_FOR_CLIENT',
    'WAITING_FOR_PROVIDER',
    'READY_FOR_REVIEW',
    'UNDER_REVIEW',
    'RESOLVED_CLIENT',
    'RESOLVED_PROVIDER',
    'CLOSED'
);

ALTER TABLE "OrderDispute"
ALTER COLUMN "status" TYPE "DisputeStatus_phase_h"
USING ("status"::text::"DisputeStatus_phase_h");

DROP TYPE "DisputeStatus";

ALTER TYPE "DisputeStatus_phase_h" RENAME TO "DisputeStatus";

ALTER TABLE "OrderDispute"
ALTER COLUMN "status" SET DEFAULT 'OPEN';

CREATE TYPE "DisputeResponseParty" AS ENUM ('CLIENT', 'PROVIDER');

CREATE TYPE "DisputeTimelineEventType" AS ENUM (
    'OPENED',
    'EVIDENCE_ADDED',
    'RESPONSE_REQUESTED',
    'RESPONSE_SUBMITTED',
    'RESPONSE_DEADLINE_EXPIRED',
    'READY_FOR_REVIEW',
    'REVIEW_STARTED',
    'RESOLVED_CLIENT',
    'RESOLVED_PROVIDER',
    'CLOSED'
);

ALTER TABLE "ProviderEarningLedgerEntry"
DROP CONSTRAINT "ProviderEarningLedgerEntry_type_shape";

CREATE TYPE "ProviderEarningLedgerEntryType_phase_h" AS ENUM (
    'EARNING_PENDING_CREDIT',
    'EARNING_AVAILABLE_RELEASE',
    'EARNING_FROZEN',
    'EARNING_UNFROZEN'
);

ALTER TABLE "ProviderEarningLedgerEntry"
ALTER COLUMN "type" TYPE "ProviderEarningLedgerEntryType_phase_h"
USING ("type"::text::"ProviderEarningLedgerEntryType_phase_h");

DROP TYPE "ProviderEarningLedgerEntryType";

ALTER TYPE "ProviderEarningLedgerEntryType_phase_h"
RENAME TO "ProviderEarningLedgerEntryType";

ALTER TABLE "ProviderEarningLedgerEntry"
ADD CONSTRAINT "ProviderEarningLedgerEntry_type_shape" CHECK (
    (
        "type" = 'EARNING_PENDING_CREDIT'
        AND "amountCentavos" > 0
        AND (("sourcePaymentId" IS NOT NULL)::integer + ("sourceRevisionPurchaseId" IS NOT NULL)::integer) = 1
    )
    OR
    (
        "type" IN ('EARNING_AVAILABLE_RELEASE', 'EARNING_FROZEN', 'EARNING_UNFROZEN')
        AND "amountCentavos" = 0
        AND "sourcePaymentId" IS NULL
        AND "sourceRevisionPurchaseId" IS NULL
    )
);

DROP INDEX "OrderDispute_orderId_key";

ALTER TABLE "OrderDispute"
ADD COLUMN "targetDeliverySubmissionId" UUID,
ADD COLUMN "targetRevisionRequestId" UUID,
ADD COLUMN "targetRevisionPurchaseId" UUID,
ADD COLUMN "responseRequestedFrom" "DisputeResponseParty",
ADD COLUMN "responseRequestedAt" TIMESTAMP(3),
ADD COLUMN "responseDeadlineAt" TIMESTAMP(3),
ADD COLUMN "responseRequestSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reviewPausedAt" TIMESTAMP(3),
ADD COLUMN "reviewRemainingSeconds" INTEGER,
ADD COLUMN "readyForReviewAt" TIMESTAMP(3),
ADD COLUMN "reviewStartedAt" TIMESTAMP(3);

ALTER TABLE "OrderDispute"
ADD CONSTRAINT "OrderDispute_response_window_shape" CHECK (
    (
        "responseRequestSequence" = 0
        AND "responseRequestedFrom" IS NULL
        AND "responseRequestedAt" IS NULL
        AND "responseDeadlineAt" IS NULL
    )
    OR
    (
        "responseRequestSequence" > 0
        AND "responseRequestedFrom" IS NOT NULL
        AND "responseRequestedAt" IS NOT NULL
        AND "responseDeadlineAt" IS NOT NULL
        AND "responseDeadlineAt" > "responseRequestedAt"
    )
),
ADD CONSTRAINT "OrderDispute_review_pause_shape" CHECK (
    ("reviewPausedAt" IS NULL AND "reviewRemainingSeconds" IS NULL)
    OR
    ("reviewPausedAt" IS NOT NULL AND "reviewRemainingSeconds" >= 0)
);

CREATE TABLE "DisputeAffectedEarning" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "providerEarningId" UUID NOT NULL,
    "preFreezeStatus" "ProviderEarningStatus" NOT NULL,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeAffectedEarning_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DisputeAffectedEarning_pre_freeze_status" CHECK (
        "preFreezeStatus" IN ('PENDING', 'AVAILABLE')
    )
);

CREATE TABLE "DisputeResponse" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "responderId" UUID NOT NULL,
    "requestedFrom" "DisputeResponseParty" NOT NULL,
    "requestSequence" INTEGER NOT NULL,
    "details" TEXT NOT NULL,
    "responseRequestedAt" TIMESTAMP(3) NOT NULL,
    "responseDeadlineAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeResponse_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DisputeResponse_request_context" CHECK (
        "requestSequence" > 0
        AND length(btrim("details")) >= 10
        AND "responseDeadlineAt" > "responseRequestedAt"
    )
);

CREATE TABLE "DisputeEvidence" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "responseId" UUID,
    "submittedById" UUID NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DisputeEvidence_metadata_shape" CHECK (
        length(btrim("originalName")) > 0
        AND length(btrim("mimeType")) > 0
        AND "sizeBytes" > 0
        AND "checksum" ~ '^[0-9a-f]{64}$'
    )
);

CREATE TABLE "DisputeTimelineEvent" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "actorId" UUID,
    "type" "DisputeTimelineEventType" NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeTimelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderDispute_one_active_per_order"
ON "OrderDispute"("orderId")
WHERE "status" IN (
    'OPEN',
    'WAITING_FOR_CLIENT',
    'WAITING_FOR_PROVIDER',
    'READY_FOR_REVIEW',
    'UNDER_REVIEW'
);

CREATE INDEX "OrderDispute_orderId_createdAt_idx"
ON "OrderDispute"("orderId", "createdAt");

CREATE INDEX "OrderDispute_status_responseDeadlineAt_id_idx"
ON "OrderDispute"("status", "responseDeadlineAt", "id");

CREATE INDEX "OrderDispute_targetDeliverySubmissionId_idx"
ON "OrderDispute"("targetDeliverySubmissionId");

CREATE INDEX "OrderDispute_targetRevisionRequestId_idx"
ON "OrderDispute"("targetRevisionRequestId");

CREATE INDEX "OrderDispute_targetRevisionPurchaseId_idx"
ON "OrderDispute"("targetRevisionPurchaseId");

CREATE UNIQUE INDEX "DisputeAffectedEarning_disputeId_providerEarningId_key"
ON "DisputeAffectedEarning"("disputeId", "providerEarningId");

CREATE INDEX "DisputeAffectedEarning_providerEarningId_createdAt_idx"
ON "DisputeAffectedEarning"("providerEarningId", "createdAt");

CREATE UNIQUE INDEX "DisputeResponse_disputeId_requestSequence_key"
ON "DisputeResponse"("disputeId", "requestSequence");

CREATE INDEX "DisputeResponse_responderId_createdAt_idx"
ON "DisputeResponse"("responderId", "createdAt");

CREATE UNIQUE INDEX "DisputeEvidence_storagePath_key"
ON "DisputeEvidence"("storagePath");

CREATE INDEX "DisputeEvidence_disputeId_createdAt_idx"
ON "DisputeEvidence"("disputeId", "createdAt");

CREATE INDEX "DisputeEvidence_responseId_createdAt_idx"
ON "DisputeEvidence"("responseId", "createdAt");

CREATE INDEX "DisputeEvidence_submittedById_createdAt_idx"
ON "DisputeEvidence"("submittedById", "createdAt");

CREATE INDEX "DisputeTimelineEvent_disputeId_createdAt_idx"
ON "DisputeTimelineEvent"("disputeId", "createdAt");

ALTER TABLE "OrderDispute"
ADD CONSTRAINT "OrderDispute_targetDeliverySubmissionId_fkey"
FOREIGN KEY ("targetDeliverySubmissionId") REFERENCES "DeliverySubmission"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "OrderDispute_targetRevisionRequestId_fkey"
FOREIGN KEY ("targetRevisionRequestId") REFERENCES "RevisionRequest"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "OrderDispute_targetRevisionPurchaseId_fkey"
FOREIGN KEY ("targetRevisionPurchaseId") REFERENCES "OrderRevisionPurchase"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DisputeAffectedEarning"
ADD CONSTRAINT "DisputeAffectedEarning_disputeId_fkey"
FOREIGN KEY ("disputeId") REFERENCES "OrderDispute"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "DisputeAffectedEarning_providerEarningId_fkey"
FOREIGN KEY ("providerEarningId") REFERENCES "ProviderEarning"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DisputeResponse"
ADD CONSTRAINT "DisputeResponse_disputeId_fkey"
FOREIGN KEY ("disputeId") REFERENCES "OrderDispute"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "DisputeResponse_responderId_fkey"
FOREIGN KEY ("responderId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DisputeEvidence"
ADD CONSTRAINT "DisputeEvidence_disputeId_fkey"
FOREIGN KEY ("disputeId") REFERENCES "OrderDispute"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "DisputeEvidence_responseId_fkey"
FOREIGN KEY ("responseId") REFERENCES "DisputeResponse"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "DisputeEvidence_submittedById_fkey"
FOREIGN KEY ("submittedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DisputeTimelineEvent"
ADD CONSTRAINT "DisputeTimelineEvent_disputeId_fkey"
FOREIGN KEY ("disputeId") REFERENCES "OrderDispute"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "DisputeTimelineEvent_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
