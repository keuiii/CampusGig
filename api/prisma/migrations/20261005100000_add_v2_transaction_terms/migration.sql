-- Phase C adds V2 transaction terms without rewriting legacy marketplace data.
CREATE TYPE "RushTier" AS ENUM ('HOURS_24', 'HOURS_12', 'HOURS_6', 'HOURS_3');
CREATE TYPE "DeliveryOption" AS ENUM ('NORMAL', 'RUSH_24_HOURS', 'RUSH_12_HOURS', 'RUSH_6_HOURS', 'RUSH_3_HOURS');

ALTER TABLE "Service"
ADD COLUMN "acceptsRushOrders" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "fastestRushTier" "RushTier";

ALTER TABLE "Order"
ALTER COLUMN "servicePackageId" DROP NOT NULL,
ALTER COLUMN "packageSnapshot" DROP NOT NULL,
ALTER COLUMN "dueAt" DROP NOT NULL,
ADD COLUMN "basePriceCentavos" INTEGER,
ADD COLUMN "rushSurchargeCentavos" INTEGER,
ADD COLUMN "deliveryOption" "DeliveryOption",
ADD COLUMN "deliveryDurationMinutes" INTEGER,
ADD COLUMN "pricingPolicyVersion" INTEGER,
ADD COLUMN "platformFeeBasisPoints" INTEGER,
ADD COLUMN "rushBasisPoints" INTEGER;
