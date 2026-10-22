-- Phase G adds typed revisions and separately accounted paid extra revisions.
-- Historical generic revision rows remain unclassified because their intent
-- cannot be reconstructed safely.
ALTER TYPE "RevisionStatus" ADD VALUE 'AWAITING_PROVIDER_ACKNOWLEDGEMENT';
ALTER TYPE "RevisionStatus" ADD VALUE 'DECLINED';

CREATE TYPE "RevisionType" AS ENUM (
    'PROVIDER_CORRECTION',
    'INCLUDED',
    'PAID_EXTRA'
);

CREATE TYPE "RevisionPurchaseActivationStatus" AS ENUM (
    'PENDING',
    'ACTIVATED',
    'RECONCILIATION_REQUIRED'
);

CREATE TYPE "ProviderEarningSource" AS ENUM (
    'ORIGINAL_ORDER',
    'PAID_EXTRA_REVISION'
);

ALTER TABLE "RevisionRequest"
ADD COLUMN "type" "RevisionType",
ADD COLUMN "sourceDeliverySubmissionId" UUID,
ADD COLUMN "revisionDeadlineAt" TIMESTAMP(3),
ADD COLUMN "turnaroundMinutes" INTEGER,
ADD COLUMN "providerAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN "declinedAt" TIMESTAMP(3);

ALTER TABLE "DeliverySubmission"
ADD COLUMN "revisionRequestId" UUID;

CREATE TABLE "OrderRevisionPurchase" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "sourceDeliverySubmissionId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "revisionRequestId" UUID,
    "instructions" TEXT NOT NULL,
    "providerSubtotalCentavos" INTEGER NOT NULL,
    "platformFeeCentavos" INTEGER NOT NULL,
    "totalCentavos" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "turnaroundMinutes" INTEGER NOT NULL,
    "pricingPolicyVersion" INTEGER NOT NULL,
    "pricingBasisCentavos" INTEGER NOT NULL,
    "deliveryDurationBasisMinutes" INTEGER NOT NULL,
    "providerPaymentId" TEXT,
    "providerCheckoutId" TEXT,
    "checkoutUrl" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "activationStatus" "RevisionPurchaseActivationStatus" NOT NULL DEFAULT 'PENDING',
    "failureCode" TEXT,
    "paidAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderRevisionPurchase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderRevisionPurchase_amount_shape" CHECK (
        "providerSubtotalCentavos" > 0
        AND "platformFeeCentavos" > 0
        AND "totalCentavos" = "providerSubtotalCentavos" + "platformFeeCentavos"
        AND "pricingBasisCentavos" > 0
    ),
    CONSTRAINT "OrderRevisionPurchase_currency_iso" CHECK (
        "currency" ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT "OrderRevisionPurchase_turnaround_bounds" CHECK (
        "turnaroundMinutes" BETWEEN 180 AND 4320
        AND "deliveryDurationBasisMinutes" > 0
    ),
    CONSTRAINT "OrderRevisionPurchase_payment_shape" CHECK (
        ("paymentStatus" IN ('PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED') AND "paidAt" IS NOT NULL)
        OR ("paymentStatus" NOT IN ('PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED') AND "paidAt" IS NULL)
    ),
    CONSTRAINT "OrderRevisionPurchase_activation_shape" CHECK (
        ("activationStatus" = 'ACTIVATED' AND "revisionRequestId" IS NOT NULL AND "activatedAt" IS NOT NULL AND "paymentStatus" = 'PAID')
        OR ("activationStatus" <> 'ACTIVATED' AND "revisionRequestId" IS NULL AND "activatedAt" IS NULL)
    )
);

DROP INDEX "ProviderEarning_orderId_key";

ALTER TABLE "ProviderEarning"
ALTER COLUMN "paymentId" DROP NOT NULL,
ADD COLUMN "revisionPurchaseId" UUID,
ADD COLUMN "sourceType" "ProviderEarningSource" NOT NULL DEFAULT 'ORIGINAL_ORDER';

ALTER TABLE "ProviderEarningLedgerEntry"
DROP CONSTRAINT "ProviderEarningLedgerEntry_type_shape",
ADD COLUMN "sourceRevisionPurchaseId" UUID;

ALTER TABLE "ProviderEarningLedgerEntry"
ADD CONSTRAINT "ProviderEarningLedgerEntry_type_shape" CHECK (
    (
        "type" = 'EARNING_PENDING_CREDIT'
        AND "amountCentavos" > 0
        AND (("sourcePaymentId" IS NOT NULL)::integer + ("sourceRevisionPurchaseId" IS NOT NULL)::integer) = 1
    )
    OR
    (
        "type" = 'EARNING_AVAILABLE_RELEASE'
        AND "amountCentavos" = 0
        AND "sourcePaymentId" IS NULL
        AND "sourceRevisionPurchaseId" IS NULL
    )
);

ALTER TABLE "ProviderEarning"
ADD CONSTRAINT "ProviderEarning_source_shape" CHECK (
    (
        "sourceType" = 'ORIGINAL_ORDER'
        AND "paymentId" IS NOT NULL
        AND "revisionPurchaseId" IS NULL
    )
    OR
    (
        "sourceType" = 'PAID_EXTRA_REVISION'
        AND "paymentId" IS NULL
        AND "revisionPurchaseId" IS NOT NULL
    )
);

CREATE INDEX "RevisionRequest_orderId_status_createdAt_idx"
ON "RevisionRequest"("orderId", "status", "createdAt");

CREATE INDEX "RevisionRequest_sourceDeliverySubmissionId_createdAt_idx"
ON "RevisionRequest"("sourceDeliverySubmissionId", "createdAt");

CREATE UNIQUE INDEX "DeliverySubmission_revisionRequestId_key"
ON "DeliverySubmission"("revisionRequestId");

CREATE UNIQUE INDEX "OrderRevisionPurchase_revisionRequestId_key"
ON "OrderRevisionPurchase"("revisionRequestId");

CREATE UNIQUE INDEX "OrderRevisionPurchase_providerPaymentId_key"
ON "OrderRevisionPurchase"("providerPaymentId");

CREATE UNIQUE INDEX "OrderRevisionPurchase_providerCheckoutId_key"
ON "OrderRevisionPurchase"("providerCheckoutId");

CREATE UNIQUE INDEX "OrderRevisionPurchase_idempotencyKey_key"
ON "OrderRevisionPurchase"("idempotencyKey");

CREATE UNIQUE INDEX "OrderRevisionPurchase_one_active_per_delivery"
ON "OrderRevisionPurchase"("sourceDeliverySubmissionId")
WHERE "paymentStatus" NOT IN ('FAILED', 'CANCELLED');

CREATE INDEX "OrderRevisionPurchase_orderId_createdAt_idx"
ON "OrderRevisionPurchase"("orderId", "createdAt");

CREATE INDEX "OrderRevisionPurchase_sourceDeliverySubmissionId_paymentSta_idx"
ON "OrderRevisionPurchase"("sourceDeliverySubmissionId", "paymentStatus");

CREATE INDEX "OrderRevisionPurchase_paymentStatus_createdAt_idx"
ON "OrderRevisionPurchase"("paymentStatus", "createdAt");

CREATE UNIQUE INDEX "ProviderEarning_revisionPurchaseId_key"
ON "ProviderEarning"("revisionPurchaseId");

-- Preserve Phase E's one-original-earning-per-order invariant while allowing
-- any number of separately identified paid-extra-revision earnings.
CREATE UNIQUE INDEX "ProviderEarning_one_original_per_order"
ON "ProviderEarning"("orderId")
WHERE "sourceType" = 'ORIGINAL_ORDER';

CREATE INDEX "ProviderEarning_orderId_sourceType_createdAt_idx"
ON "ProviderEarning"("orderId", "sourceType", "createdAt");

CREATE UNIQUE INDEX "ProviderEarningLedgerEntry_sourceRevisionPurchaseId_key"
ON "ProviderEarningLedgerEntry"("sourceRevisionPurchaseId");

ALTER TABLE "RevisionRequest"
ADD CONSTRAINT "RevisionRequest_sourceDeliverySubmissionId_fkey"
FOREIGN KEY ("sourceDeliverySubmissionId") REFERENCES "DeliverySubmission"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeliverySubmission"
ADD CONSTRAINT "DeliverySubmission_revisionRequestId_fkey"
FOREIGN KEY ("revisionRequestId") REFERENCES "RevisionRequest"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderRevisionPurchase"
ADD CONSTRAINT "OrderRevisionPurchase_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "OrderRevisionPurchase_sourceDeliverySubmissionId_fkey"
FOREIGN KEY ("sourceDeliverySubmissionId") REFERENCES "DeliverySubmission"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "OrderRevisionPurchase_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "OrderRevisionPurchase_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "OrderRevisionPurchase_revisionRequestId_fkey"
FOREIGN KEY ("revisionRequestId") REFERENCES "RevisionRequest"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderEarning"
ADD CONSTRAINT "ProviderEarning_revisionPurchaseId_fkey"
FOREIGN KEY ("revisionPurchaseId") REFERENCES "OrderRevisionPurchase"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderEarningLedgerEntry"
ADD CONSTRAINT "ProviderEarningLedgerEntry_sourceRevisionPurchaseId_fkey"
FOREIGN KEY ("sourceRevisionPurchaseId") REFERENCES "OrderRevisionPurchase"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
