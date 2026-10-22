-- Phase E introduces pending provider-earnings shadow accounting. It does not
-- release, freeze, refund, withdraw, or pay out earnings.
CREATE TYPE "ProviderEarningStatus" AS ENUM (
    'PENDING',
    'AVAILABLE',
    'FROZEN',
    'PAYOUT_PROCESSING',
    'PAID_OUT',
    'REFUNDED'
);

CREATE TYPE "ProviderEarningLedgerEntryType" AS ENUM (
    'EARNING_PENDING_CREDIT'
);

CREATE TABLE "ProviderEarning" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "grossServiceAmountCentavos" INTEGER NOT NULL,
    "status" "ProviderEarningStatus" NOT NULL DEFAULT 'PENDING',
    "pendingAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderEarning_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProviderEarning_positive_principal" CHECK (
        "grossServiceAmountCentavos" > 0
    ),
    CONSTRAINT "ProviderEarning_currency_iso" CHECK (
        "currency" ~ '^[A-Z]{3}$'
    )
);

CREATE TABLE "ProviderEarningLedgerEntry" (
    "id" UUID NOT NULL,
    "providerEarningId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "sourcePaymentId" UUID,
    "type" "ProviderEarningLedgerEntryType" NOT NULL,
    "amountCentavos" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEarningLedgerEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProviderEarningLedgerEntry_positive_credit" CHECK (
        "amountCentavos" > 0
    ),
    CONSTRAINT "ProviderEarningLedgerEntry_currency_iso" CHECK (
        "currency" ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT "ProviderEarningLedgerEntry_pending_credit_source" CHECK (
        "type" <> 'EARNING_PENDING_CREDIT' OR "sourcePaymentId" IS NOT NULL
    )
);

CREATE UNIQUE INDEX "ProviderEarning_orderId_key"
ON "ProviderEarning"("orderId");

CREATE UNIQUE INDEX "ProviderEarning_paymentId_key"
ON "ProviderEarning"("paymentId");

CREATE INDEX "ProviderEarning_providerId_status_createdAt_idx"
ON "ProviderEarning"("providerId", "status", "createdAt");

CREATE INDEX "ProviderEarning_providerId_createdAt_idx"
ON "ProviderEarning"("providerId", "createdAt");

CREATE UNIQUE INDEX "ProviderEarningLedgerEntry_sourcePaymentId_key"
ON "ProviderEarningLedgerEntry"("sourcePaymentId");

CREATE UNIQUE INDEX "ProviderEarningLedgerEntry_sourceKey_key"
ON "ProviderEarningLedgerEntry"("sourceKey");

CREATE INDEX "ProviderEarningLedgerEntry_providerEarningId_createdAt_idx"
ON "ProviderEarningLedgerEntry"("providerEarningId", "createdAt");

CREATE INDEX "ProviderEarningLedgerEntry_providerId_createdAt_idx"
ON "ProviderEarningLedgerEntry"("providerId", "createdAt");

CREATE INDEX "ProviderEarningLedgerEntry_orderId_idx"
ON "ProviderEarningLedgerEntry"("orderId");

-- A partial refund cannot be represented truthfully until the later refund
-- accounting phase adds debit movements. Fail rather than invent a net amount.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Payment" AS payment
        WHERE payment."status" = 'PARTIALLY_REFUNDED'
           OR (
                payment."refundedCentavos" > 0
                AND payment."refundedCentavos" < payment."amountCentavos"
           )
           OR EXISTS (
                SELECT 1
                FROM "PaymentRefund" AS refund
                WHERE refund."paymentId" = payment."id"
                  AND refund."status" = 'SUCCEEDED'
                GROUP BY refund."paymentId"
                HAVING SUM(refund."amountCentavos") > 0
                   AND SUM(refund."amountCentavos") < payment."amountCentavos"
           )
    ) THEN
        RAISE EXCEPTION
            'Phase E cannot backfill partially refunded provider earnings without refund ledger debits';
    END IF;
END $$;

-- More than one authoritative paid payment for an order makes the initial
-- earning source ambiguous. Refuse to choose one silently.
DO $$
BEGIN
    IF EXISTS (
        SELECT payment."orderId"
        FROM "Payment" AS payment
        WHERE payment."status" = 'PAID'
        GROUP BY payment."orderId"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Phase E found more than one paid payment for an order';
    END IF;
END $$;

WITH "eligiblePaidOrders" AS (
    SELECT
        payment."id" AS "paymentId",
        payment."orderId",
        orders."providerId",
        payment."currency",
        CASE
            WHEN orders."pricingModel" = 'SINGLE_PRICE_V2'
                THEN orders."subtotalCentavos"
            ELSE payment."providerNetCentavos"
        END AS "principalCentavos",
        payment."paidAt"
    FROM "Payment" AS payment
    JOIN "Order" AS orders
      ON orders."id" = payment."orderId"
    WHERE payment."status" = 'PAID'
      AND payment."paidAt" IS NOT NULL
      AND payment."refundedCentavos" = 0
      AND payment."currency" = orders."currency"
      AND payment."currency" ~ '^[A-Z]{3}$'
      AND payment."amountCentavos" = orders."totalCentavos"
      AND payment."platformFeeCentavos" = orders."platformFeeCentavos"
      AND (
          (
              orders."pricingModel" = 'SINGLE_PRICE_V2'
              AND orders."subtotalCentavos" > 0
              AND payment."providerNetCentavos" = orders."subtotalCentavos"
          )
          OR (
              orders."pricingModel" = 'LEGACY_PACKAGE_V1'
              AND payment."providerNetCentavos" > 0
          )
      )
      AND NOT EXISTS (
          SELECT 1
          FROM "PaymentRefund" AS refund
          WHERE refund."paymentId" = payment."id"
            AND refund."status" = 'SUCCEEDED'
      )
)
INSERT INTO "ProviderEarning" (
    "id",
    "providerId",
    "orderId",
    "paymentId",
    "currency",
    "grossServiceAmountCentavos",
    "status",
    "pendingAt",
    "createdAt",
    "updatedAt"
)
SELECT
    md5('campusgig-provider-earning:' || eligible."orderId"::text)::UUID,
    eligible."providerId",
    eligible."orderId",
    eligible."paymentId",
    eligible."currency",
    eligible."principalCentavos",
    'PENDING'::"ProviderEarningStatus",
    eligible."paidAt",
    eligible."paidAt",
    eligible."paidAt"
FROM "eligiblePaidOrders" AS eligible;

INSERT INTO "ProviderEarningLedgerEntry" (
    "id",
    "providerEarningId",
    "providerId",
    "orderId",
    "sourcePaymentId",
    "type",
    "amountCentavos",
    "currency",
    "sourceKey",
    "createdAt"
)
SELECT
    md5('campusgig-provider-earning-pending-credit:' || earning."orderId"::text)::UUID,
    earning."id",
    earning."providerId",
    earning."orderId",
    earning."paymentId",
    'EARNING_PENDING_CREDIT'::"ProviderEarningLedgerEntryType",
    earning."grossServiceAmountCentavos",
    earning."currency",
    'payment:' || earning."paymentId"::text || ':earning-pending-credit',
    earning."pendingAt"
FROM "ProviderEarning" AS earning;

ALTER TABLE "ProviderEarning"
ADD CONSTRAINT "ProviderEarning_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderEarning"
ADD CONSTRAINT "ProviderEarning_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderEarning"
ADD CONSTRAINT "ProviderEarning_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderEarningLedgerEntry"
ADD CONSTRAINT "ProviderEarningLedgerEntry_providerEarningId_fkey"
FOREIGN KEY ("providerEarningId") REFERENCES "ProviderEarning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderEarningLedgerEntry"
ADD CONSTRAINT "ProviderEarningLedgerEntry_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderEarningLedgerEntry"
ADD CONSTRAINT "ProviderEarningLedgerEntry_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderEarningLedgerEntry"
ADD CONSTRAINT "ProviderEarningLedgerEntry_sourcePaymentId_fkey"
FOREIGN KEY ("sourcePaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
