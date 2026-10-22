-- Phase I introduces full marketplace refunds and explicit reversal accounting.
-- Historical refund rows remain valid and are linked to their original order
-- where that relationship can be derived without inventing actor or policy data.

ALTER TABLE "OrderRevisionPurchase"
ALTER COLUMN "activationStatus" DROP DEFAULT,
DROP CONSTRAINT "OrderRevisionPurchase_activation_shape";

CREATE TYPE "RevisionPurchaseActivationStatus_phase_i" AS ENUM (
    'PENDING',
    'ACTIVATED',
    'RECONCILIATION_REQUIRED',
    'REFUNDED'
);

ALTER TABLE "OrderRevisionPurchase"
ALTER COLUMN "activationStatus" TYPE "RevisionPurchaseActivationStatus_phase_i"
USING ("activationStatus"::text::"RevisionPurchaseActivationStatus_phase_i");

DROP TYPE "RevisionPurchaseActivationStatus";
ALTER TYPE "RevisionPurchaseActivationStatus_phase_i"
RENAME TO "RevisionPurchaseActivationStatus";

ALTER TABLE "OrderRevisionPurchase"
ALTER COLUMN "activationStatus" SET DEFAULT 'PENDING';

ALTER TABLE "OrderRevisionPurchase"
ADD CONSTRAINT "OrderRevisionPurchase_activation_shape" CHECK (
    (
        "activationStatus" = 'ACTIVATED'
        AND "revisionRequestId" IS NOT NULL
        AND "activatedAt" IS NOT NULL
        AND "paymentStatus" IN ('PAID', 'REFUND_PENDING')
    )
    OR
    (
        "activationStatus" = 'REFUNDED'
        AND "paymentStatus" = 'REFUNDED'
        AND (
            ("revisionRequestId" IS NULL AND "activatedAt" IS NULL)
            OR
            ("revisionRequestId" IS NOT NULL AND "activatedAt" IS NOT NULL)
        )
    )
    OR
    (
        "activationStatus" IN ('PENDING', 'RECONCILIATION_REQUIRED')
        AND "revisionRequestId" IS NULL
        AND "activatedAt" IS NULL
    )
);

ALTER TABLE "PaymentRefund"
ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "RefundStatus_phase_i" AS ENUM (
    'REQUESTED',
    'PENDING',
    'PROCESSING',
    'SUCCEEDED',
    'FAILED',
    'RECONCILIATION_REQUIRED'
);

ALTER TABLE "PaymentRefund"
ALTER COLUMN "status" TYPE "RefundStatus_phase_i"
USING ("status"::text::"RefundStatus_phase_i");

DROP TYPE "RefundStatus";
ALTER TYPE "RefundStatus_phase_i" RENAME TO "RefundStatus";

ALTER TABLE "ProviderEarningLedgerEntry"
DROP CONSTRAINT "ProviderEarningLedgerEntry_type_shape";

CREATE TYPE "ProviderEarningLedgerEntryType_phase_i" AS ENUM (
    'EARNING_PENDING_CREDIT',
    'EARNING_AVAILABLE_RELEASE',
    'EARNING_FROZEN',
    'EARNING_UNFROZEN',
    'EARNING_REFUND_REVERSAL'
);

ALTER TABLE "ProviderEarningLedgerEntry"
ALTER COLUMN "type" TYPE "ProviderEarningLedgerEntryType_phase_i"
USING ("type"::text::"ProviderEarningLedgerEntryType_phase_i");

DROP TYPE "ProviderEarningLedgerEntryType";
ALTER TYPE "ProviderEarningLedgerEntryType_phase_i"
RENAME TO "ProviderEarningLedgerEntryType";

CREATE TYPE "MarketplaceRefundSource" AS ENUM (
    'ORIGINAL_ORDER',
    'PAID_EXTRA_REVISION'
);

CREATE TYPE "MarketplaceRefundReason" AS ENUM (
    'PAID_NOT_STARTED',
    'MISSED_RUSH_DEADLINE',
    'DISPUTE_CLIENT_WIN',
    'STALE_REVISION_PAYMENT',
    'ADMIN_EXCEPTION'
);

CREATE TYPE "RefundRequestOrigin" AS ENUM ('CLIENT', 'ADMIN', 'SYSTEM');
CREATE TYPE "PlatformFeeLedgerEntryType" AS ENUM ('REFUND_REVERSAL');

ALTER TABLE "PaymentRefund"
ALTER COLUMN "paymentId" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'REQUESTED',
ADD COLUMN "orderId" UUID,
ADD COLUMN "revisionPurchaseId" UUID,
ADD COLUMN "providerEarningId" UUID,
ADD COLUMN "triggeringDisputeId" UUID,
ADD COLUMN "requestedById" UUID,
ADD COLUMN "sourceType" "MarketplaceRefundSource",
ADD COLUMN "reasonCode" "MarketplaceRefundReason",
ADD COLUMN "requestOrigin" "RefundRequestOrigin",
ADD COLUMN "preRefundEarningStatus" "ProviderEarningStatus",
ADD COLUMN "sourceKey" TEXT,
ADD COLUMN "providerPrincipalCentavos" INTEGER,
ADD COLUMN "platformFeeCentavos" INTEGER,
ADD COLUMN "refundTotalCentavos" INTEGER,
ADD COLUMN "currency" TEXT,
ADD COLUMN "providerStatus" TEXT,
ADD COLUMN "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "reconciliationRequiredAt" TIMESTAMP(3),
ADD COLUMN "accountingReversedAt" TIMESTAMP(3),
ADD COLUMN "providerPrincipalReversedCentavos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "platformFeeReversedCentavos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "providerCreatedAt" TIMESTAMP(3),
ADD COLUMN "providerUpdatedAt" TIMESTAMP(3);

UPDATE "PaymentRefund" AS refund
SET
    "orderId" = payment."orderId",
    "sourceType" = 'ORIGINAL_ORDER',
    "providerPrincipalCentavos" = payment."providerNetCentavos",
    "platformFeeCentavos" = payment."platformFeeCentavos",
    "refundTotalCentavos" = refund."amountCentavos",
    "currency" = payment."currency",
    "providerStatus" = lower(refund."status"::text),
    "requestedAt" = refund."createdAt"
FROM "Payment" AS payment
WHERE refund."paymentId" = payment."id";

ALTER TABLE "PaymentRefund"
ADD CONSTRAINT "PaymentRefund_phase_i_shape" CHECK (
    "sourceKey" IS NULL
    OR (
        "orderId" IS NOT NULL
        AND "providerEarningId" IS NOT NULL
        AND "sourceType" IS NOT NULL
        AND "reasonCode" IS NOT NULL
        AND "requestOrigin" IS NOT NULL
        AND "requestedById" IS NOT NULL
        AND "preRefundEarningStatus" IN ('PENDING', 'AVAILABLE', 'FROZEN')
        AND "providerPrincipalCentavos" > 0
        AND "platformFeeCentavos" >= 0
        AND "refundTotalCentavos" = "providerPrincipalCentavos" + "platformFeeCentavos"
        AND "amountCentavos" = "refundTotalCentavos"
        AND length(btrim("currency")) = 3
        AND (
            ("sourceType" = 'ORIGINAL_ORDER' AND "paymentId" IS NOT NULL AND "revisionPurchaseId" IS NULL)
            OR
            ("sourceType" = 'PAID_EXTRA_REVISION' AND "paymentId" IS NULL AND "revisionPurchaseId" IS NOT NULL)
        )
        AND (
            ("reasonCode" = 'DISPUTE_CLIENT_WIN' AND "triggeringDisputeId" IS NOT NULL)
            OR
            ("reasonCode" <> 'DISPUTE_CLIENT_WIN' AND "triggeringDisputeId" IS NULL)
        )
        AND (
            (
                "status" = 'SUCCEEDED'
                AND "processedAt" IS NOT NULL
                AND "accountingReversedAt" IS NOT NULL
                AND "providerPrincipalReversedCentavos" = "providerPrincipalCentavos"
                AND "platformFeeReversedCentavos" = "platformFeeCentavos"
            )
            OR
            (
                "status" <> 'SUCCEEDED'
                AND "accountingReversedAt" IS NULL
                AND "providerPrincipalReversedCentavos" = 0
                AND "platformFeeReversedCentavos" = 0
            )
        )
    )
);

ALTER TABLE "ProviderEarningLedgerEntry"
ADD CONSTRAINT "ProviderEarningLedgerEntry_type_shape" CHECK (
    (
        "type" = 'EARNING_PENDING_CREDIT'
        AND "amountCentavos" > 0
        AND (("sourcePaymentId" IS NOT NULL)::integer + ("sourceRevisionPurchaseId" IS NOT NULL)::integer) = 1
    )
    OR
    (
        "type" = 'EARNING_REFUND_REVERSAL'
        AND "amountCentavos" < 0
        AND "sourcePaymentId" IS NULL
        AND "sourceRevisionPurchaseId" IS NULL
    )
    OR
    (
        "type" IN ('EARNING_AVAILABLE_RELEASE', 'EARNING_FROZEN', 'EARNING_UNFROZEN')
        AND "amountCentavos" = 0
        AND "sourcePaymentId" IS NULL
        AND "sourceRevisionPurchaseId" IS NULL
    )
);

ALTER TABLE "OrderRevisionPurchase"
ADD COLUMN "refundedCentavos" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "OrderRevisionPurchase_refunded_amount" CHECK (
    "refundedCentavos" >= 0 AND "refundedCentavos" <= "totalCentavos"
);

DROP INDEX "OrderRevisionPurchase_one_active_per_delivery";
CREATE UNIQUE INDEX "OrderRevisionPurchase_one_active_per_delivery"
ON "OrderRevisionPurchase"("sourceDeliverySubmissionId")
WHERE "paymentStatus" NOT IN ('FAILED', 'CANCELLED', 'REFUNDED');

CREATE TABLE "PlatformFeeLedgerEntry" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "refundId" UUID NOT NULL,
    "type" "PlatformFeeLedgerEntryType" NOT NULL,
    "amountCentavos" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFeeLedgerEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformFeeLedgerEntry_refund_reversal_shape" CHECK (
        "type" = 'REFUND_REVERSAL'
        AND "amountCentavos" <= 0
        AND length(btrim("currency")) = 3
    )
);

CREATE UNIQUE INDEX "PaymentRefund_sourceKey_key" ON "PaymentRefund"("sourceKey");
CREATE INDEX "PaymentRefund_revisionPurchaseId_status_createdAt_idx"
ON "PaymentRefund"("revisionPurchaseId", "status", "createdAt");
CREATE INDEX "PaymentRefund_orderId_status_createdAt_idx"
ON "PaymentRefund"("orderId", "status", "createdAt");
CREATE INDEX "PaymentRefund_status_updatedAt_idx"
ON "PaymentRefund"("status", "updatedAt");
CREATE INDEX "PaymentRefund_triggeringDisputeId_idx"
ON "PaymentRefund"("triggeringDisputeId");

CREATE UNIQUE INDEX "PlatformFeeLedgerEntry_refundId_key"
ON "PlatformFeeLedgerEntry"("refundId");
CREATE UNIQUE INDEX "PlatformFeeLedgerEntry_sourceKey_key"
ON "PlatformFeeLedgerEntry"("sourceKey");
CREATE INDEX "PlatformFeeLedgerEntry_orderId_createdAt_idx"
ON "PlatformFeeLedgerEntry"("orderId", "createdAt");

ALTER TABLE "PaymentRefund"
ADD CONSTRAINT "PaymentRefund_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "PaymentRefund_revisionPurchaseId_fkey"
FOREIGN KEY ("revisionPurchaseId") REFERENCES "OrderRevisionPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "PaymentRefund_providerEarningId_fkey"
FOREIGN KEY ("providerEarningId") REFERENCES "ProviderEarning"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "PaymentRefund_triggeringDisputeId_fkey"
FOREIGN KEY ("triggeringDisputeId") REFERENCES "OrderDispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "PaymentRefund_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformFeeLedgerEntry"
ADD CONSTRAINT "PlatformFeeLedgerEntry_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "PlatformFeeLedgerEntry_refundId_fkey"
FOREIGN KEY ("refundId") REFERENCES "PaymentRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
