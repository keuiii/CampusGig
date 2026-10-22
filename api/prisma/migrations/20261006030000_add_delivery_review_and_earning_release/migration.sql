-- Phase F adds authoritative review windows for new deliveries only.
-- Historical submitted/completed orders are intentionally left unchanged.
CREATE TYPE "OrderCompletionSource" AS ENUM (
    'CLIENT_ACCEPTED',
    'AUTO_REVIEW_TIMEOUT'
);

-- PostgreSQL does not allow a newly-added enum value to be referenced by a
-- constraint in the same transaction. Replace the type transactionally while
-- preserving every existing ledger value.
ALTER TABLE "ProviderEarningLedgerEntry"
DROP CONSTRAINT "ProviderEarningLedgerEntry_positive_credit",
DROP CONSTRAINT "ProviderEarningLedgerEntry_pending_credit_source";

CREATE TYPE "ProviderEarningLedgerEntryType_phase_f" AS ENUM (
    'EARNING_PENDING_CREDIT',
    'EARNING_AVAILABLE_RELEASE'
);

ALTER TABLE "ProviderEarningLedgerEntry"
ALTER COLUMN "type" TYPE "ProviderEarningLedgerEntryType_phase_f"
USING ("type"::text::"ProviderEarningLedgerEntryType_phase_f");

DROP TYPE "ProviderEarningLedgerEntryType";

ALTER TYPE "ProviderEarningLedgerEntryType_phase_f"
RENAME TO "ProviderEarningLedgerEntryType";

ALTER TABLE "Order"
ADD COLUMN "completionSource" "OrderCompletionSource",
ADD COLUMN "reviewPolicyVersion" INTEGER,
ADD COLUMN "reviewStartedAt" TIMESTAMP(3),
ADD COLUMN "reviewDeadlineAt" TIMESTAMP(3),
ADD COLUMN "reviewDeliverySubmissionId" UUID;

ALTER TABLE "ProviderEarning"
ADD COLUMN "availableAt" TIMESTAMP(3);

ALTER TABLE "OrderStatusHistory"
ALTER COLUMN "changedBy" DROP NOT NULL;

ALTER TABLE "ProviderEarningLedgerEntry"
ADD CONSTRAINT "ProviderEarningLedgerEntry_type_shape" CHECK (
    (
        "type" = 'EARNING_PENDING_CREDIT'
        AND "amountCentavos" > 0
        AND "sourcePaymentId" IS NOT NULL
    )
    OR
    (
        "type" = 'EARNING_AVAILABLE_RELEASE'
        AND "amountCentavos" = 0
        AND "sourcePaymentId" IS NULL
    )
);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_review_window_shape" CHECK (
    (
        "reviewPolicyVersion" IS NULL
        AND "reviewStartedAt" IS NULL
        AND "reviewDeadlineAt" IS NULL
        AND "reviewDeliverySubmissionId" IS NULL
    )
    OR
    (
        "reviewPolicyVersion" = 1
        AND "reviewStartedAt" IS NOT NULL
        AND "reviewDeadlineAt" IS NOT NULL
        AND "reviewDeliverySubmissionId" IS NOT NULL
        AND "reviewDeadlineAt" > "reviewStartedAt"
    )
);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_completion_source_shape" CHECK (
    "completionSource" IS NULL
    OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
);

ALTER TABLE "ProviderEarning"
ADD CONSTRAINT "ProviderEarning_available_timestamp" CHECK (
    "status" <> 'AVAILABLE' OR "availableAt" IS NOT NULL
);

CREATE UNIQUE INDEX "Order_reviewDeliverySubmissionId_key"
ON "Order"("reviewDeliverySubmissionId");

CREATE INDEX "Order_status_reviewDeadlineAt_id_idx"
ON "Order"("status", "reviewDeadlineAt", "id");

ALTER TABLE "Order"
ADD CONSTRAINT "Order_reviewDeliverySubmissionId_fkey"
FOREIGN KEY ("reviewDeliverySubmissionId") REFERENCES "DeliverySubmission"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
