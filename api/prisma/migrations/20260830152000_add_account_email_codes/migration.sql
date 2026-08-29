CREATE TYPE "AccountCodePurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Accounts created before email verification was introduced remain usable.
UPDATE "User" SET "emailVerifiedAt" = "createdAt";

CREATE TABLE "AccountCode" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "purpose" "AccountCodePurpose" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AccountCode_userId_purpose_createdAt_idx" ON "AccountCode"("userId", "purpose", "createdAt");
