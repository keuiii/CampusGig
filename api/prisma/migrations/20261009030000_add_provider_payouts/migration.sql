-- Phase J adds provider payout reservations and manual settlement accounting.
-- Existing earnings remain unchanged; no historical payout or destination is fabricated.

ALTER TABLE "ProviderEarningLedgerEntry"
DROP CONSTRAINT "ProviderEarningLedgerEntry_type_shape";

CREATE TYPE "ProviderEarningLedgerEntryType_phase_j" AS ENUM (
    'EARNING_PENDING_CREDIT',
    'EARNING_AVAILABLE_RELEASE',
    'EARNING_FROZEN',
    'EARNING_UNFROZEN',
    'EARNING_REFUND_REVERSAL',
    'EARNING_PAYOUT_RESERVED',
    'EARNING_PAYOUT_RELEASED',
    'EARNING_PAID_OUT'
);

ALTER TABLE "ProviderEarningLedgerEntry"
ALTER COLUMN "type" TYPE "ProviderEarningLedgerEntryType_phase_j"
USING ("type"::text::"ProviderEarningLedgerEntryType_phase_j");

DROP TYPE "ProviderEarningLedgerEntryType";
ALTER TYPE "ProviderEarningLedgerEntryType_phase_j"
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
        "type" = 'EARNING_REFUND_REVERSAL'
        AND "amountCentavos" < 0
        AND "sourcePaymentId" IS NULL
        AND "sourceRevisionPurchaseId" IS NULL
    )
    OR
    (
        "type" IN (
            'EARNING_AVAILABLE_RELEASE',
            'EARNING_FROZEN',
            'EARNING_UNFROZEN',
            'EARNING_PAYOUT_RESERVED',
            'EARNING_PAYOUT_RELEASED',
            'EARNING_PAID_OUT'
        )
        AND "amountCentavos" = 0
        AND "sourcePaymentId" IS NULL
        AND "sourceRevisionPurchaseId" IS NULL
    )
);

CREATE TYPE "PayoutDestinationType" AS ENUM ('BANK_ACCOUNT', 'E_WALLET');
CREATE TYPE "PayoutDestinationVerificationStatus" AS ENUM (
    'UNVERIFIED',
    'ADMIN_REVIEWED',
    'PROVIDER_VERIFIED'
);
CREATE TYPE "ProviderPayoutStatus" AS ENUM (
    'REQUESTED',
    'APPROVED',
    'PROCESSING',
    'PAID',
    'FAILED',
    'REJECTED',
    'CANCELLED',
    'RECONCILIATION_REQUIRED'
);
CREATE TYPE "PayoutSettlementMethod" AS ENUM ('MANUAL', 'EXTERNAL_PROVIDER');
CREATE TYPE "ProviderPayoutAuditAction" AS ENUM (
    'REQUESTED',
    'CANCELLED',
    'APPROVED',
    'REJECTED',
    'PROCESSING',
    'MANUAL_SETTLED',
    'EXTERNAL_RECONCILED',
    'FAILED',
    'RECONCILIATION_REQUIRED'
);

CREATE TABLE "ProviderPayoutDestination" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "type" "PayoutDestinationType" NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "maskedAccountIdentifier" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "providerAdapterKey" TEXT,
    "externalReferenceToken" TEXT,
    "verificationStatus" "PayoutDestinationVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderPayoutDestination_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProviderPayoutDestination_masked_shape" CHECK (
        length(btrim("displayLabel")) BETWEEN 2 AND 80
        AND length(btrim("maskedAccountIdentifier")) BETWEEN 4 AND 40
        AND length(btrim("accountHolderName")) BETWEEN 2 AND 120
        AND "maskedAccountIdentifier" !~ '[0-9]{5,}'
    ),
    CONSTRAINT "ProviderPayoutDestination_review_shape" CHECK (
        ("verificationStatus" = 'UNVERIFIED' AND "reviewedById" IS NULL AND "reviewedAt" IS NULL)
        OR
        ("verificationStatus" <> 'UNVERIFIED' AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND length(btrim("reviewNote")) >= 20)
    )
);

CREATE TABLE "ProviderPayout" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "destinationId" UUID NOT NULL,
    "clientRequestId" UUID NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "requestedPrincipalCentavos" INTEGER NOT NULL,
    "eligiblePrincipalCentavos" INTEGER NOT NULL,
    "payoutFeeCentavos" INTEGER NOT NULL DEFAULT 0,
    "netDisbursementCentavos" INTEGER NOT NULL,
    "status" "ProviderPayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "destinationSnapshot" JSONB NOT NULL,
    "settlementMethod" "PayoutSettlementMethod",
    "providerAdapterKey" TEXT,
    "externalPayoutId" TEXT,
    "externalStatus" TEXT,
    "failureCode" TEXT,
    "reconciliationContext" TEXT,
    "approvedById" UUID,
    "settledById" UUID,
    "manualSettlementReference" TEXT,
    "settlementNote" TEXT,
    "settlementAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "reconciliationRequiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderPayout_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProviderPayout_amount_shape" CHECK (
        "requestedPrincipalCentavos" > 0
        AND "eligiblePrincipalCentavos" = "requestedPrincipalCentavos"
        AND "payoutFeeCentavos" = 0
        AND "netDisbursementCentavos" = "requestedPrincipalCentavos"
        AND length(btrim("currency")) = 3
    ),
    CONSTRAINT "ProviderPayout_status_timestamps" CHECK (
        ("status" <> 'APPROVED' OR "approvedAt" IS NOT NULL)
        AND ("status" <> 'PROCESSING' OR ("approvedAt" IS NOT NULL AND "processingAt" IS NOT NULL))
        AND ("status" <> 'PAID' OR ("paidAt" IS NOT NULL AND "settlementAt" IS NOT NULL AND "settledById" IS NOT NULL AND "manualSettlementReference" IS NOT NULL AND length(btrim("settlementNote")) >= 20))
        AND ("status" <> 'REJECTED' OR "rejectedAt" IS NOT NULL)
        AND ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL)
        AND ("status" <> 'FAILED' OR "failedAt" IS NOT NULL)
        AND ("status" <> 'RECONCILIATION_REQUIRED' OR "reconciliationRequiredAt" IS NOT NULL)
    )
);

CREATE TABLE "ProviderPayoutItem" (
    "id" UUID NOT NULL,
    "payoutId" UUID NOT NULL,
    "providerEarningId" UUID NOT NULL,
    "principalCentavos" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reservationActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderPayoutItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProviderPayoutItem_amount_shape" CHECK (
        "principalCentavos" > 0 AND length(btrim("currency")) = 3
    )
);

CREATE TABLE "ProviderPayoutAudit" (
    "id" UUID NOT NULL,
    "payoutId" UUID NOT NULL,
    "actorId" UUID,
    "action" "ProviderPayoutAuditAction" NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderPayoutAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayoutDestination_provider_type_mask_idx"
ON "ProviderPayoutDestination"("providerId", "type", "maskedAccountIdentifier");
CREATE INDEX "ProviderPayoutDestination_providerId_isActive_createdAt_idx"
ON "ProviderPayoutDestination"("providerId", "isActive", "createdAt");
CREATE INDEX "ProviderPayoutDestination_verificationStatus_createdAt_idx"
ON "ProviderPayoutDestination"("verificationStatus", "createdAt");

CREATE UNIQUE INDEX "ProviderPayout_sourceKey_key" ON "ProviderPayout"("sourceKey");
CREATE UNIQUE INDEX "ProviderPayout_externalPayoutId_key" ON "ProviderPayout"("externalPayoutId");
CREATE UNIQUE INDEX "ProviderPayout_manualSettlementReference_key" ON "ProviderPayout"("manualSettlementReference");
CREATE UNIQUE INDEX "ProviderPayout_providerId_clientRequestId_key"
ON "ProviderPayout"("providerId", "clientRequestId");
CREATE INDEX "ProviderPayout_providerId_status_requestedAt_idx"
ON "ProviderPayout"("providerId", "status", "requestedAt");
CREATE INDEX "ProviderPayout_status_requestedAt_idx" ON "ProviderPayout"("status", "requestedAt");
CREATE INDEX "ProviderPayout_destinationId_requestedAt_idx" ON "ProviderPayout"("destinationId", "requestedAt");

CREATE UNIQUE INDEX "ProviderPayoutItem_payoutId_providerEarningId_key"
ON "ProviderPayoutItem"("payoutId", "providerEarningId");
CREATE INDEX "ProviderPayoutItem_providerEarningId_reservationActive_idx"
ON "ProviderPayoutItem"("providerEarningId", "reservationActive");
CREATE UNIQUE INDEX "ProviderPayoutItem_one_active_reservation_per_earning"
ON "ProviderPayoutItem"("providerEarningId") WHERE "reservationActive" = true;

CREATE INDEX "ProviderPayoutAudit_payoutId_createdAt_idx"
ON "ProviderPayoutAudit"("payoutId", "createdAt");
CREATE INDEX "ProviderPayoutAudit_actorId_createdAt_idx"
ON "ProviderPayoutAudit"("actorId", "createdAt");

ALTER TABLE "ProviderPayoutDestination"
ADD CONSTRAINT "ProviderPayoutDestination_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ProviderPayoutDestination_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderPayout"
ADD CONSTRAINT "ProviderPayout_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ProviderPayout_destinationId_fkey"
FOREIGN KEY ("destinationId") REFERENCES "ProviderPayoutDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ProviderPayout_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ProviderPayout_settledById_fkey"
FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderPayoutItem"
ADD CONSTRAINT "ProviderPayoutItem_payoutId_fkey"
FOREIGN KEY ("payoutId") REFERENCES "ProviderPayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ProviderPayoutItem_providerEarningId_fkey"
FOREIGN KEY ("providerEarningId") REFERENCES "ProviderEarning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderPayoutAudit"
ADD CONSTRAINT "ProviderPayoutAudit_payoutId_fkey"
FOREIGN KEY ("payoutId") REFERENCES "ProviderPayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ProviderPayoutAudit_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
