ALTER TABLE "Service"
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedBy" UUID,
ADD COLUMN "rejectionReason" TEXT;
