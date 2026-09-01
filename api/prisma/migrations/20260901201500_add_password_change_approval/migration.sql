CREATE TABLE "PasswordChangeRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "newPasswordHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordChangeRequest_tokenHash_key" ON "PasswordChangeRequest"("tokenHash");
CREATE INDEX "PasswordChangeRequest_userId_status_expiresAt_idx" ON "PasswordChangeRequest"("userId", "status", "expiresAt");
ALTER TABLE "PasswordChangeRequest" ADD CONSTRAINT "PasswordChangeRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
