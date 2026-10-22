-- Add nullable canonical terms for SINGLE_PRICE_V2 listings. Existing legacy
-- services remain unchanged and continue to use ServicePackage rows.
ALTER TABLE "Service"
ADD COLUMN "basePriceCentavos" INTEGER,
ADD COLUMN "normalDeliveryMinutes" INTEGER,
ADD COLUMN "includedRevisionLimit" INTEGER;
