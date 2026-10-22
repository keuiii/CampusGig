CREATE TABLE "SavedService" (
    "userId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedService_pkey" PRIMARY KEY ("userId","serviceId")
);

CREATE INDEX "SavedService_userId_createdAt_idx" ON "SavedService"("userId", "createdAt");

ALTER TABLE "SavedService" ADD CONSTRAINT "SavedService_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SavedService" ADD CONSTRAINT "SavedService_serviceId_fkey"
FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
