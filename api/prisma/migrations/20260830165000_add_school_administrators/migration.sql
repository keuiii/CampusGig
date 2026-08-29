ALTER TYPE "UserRole" ADD VALUE 'SCHOOL_ADMIN' BEFORE 'ADMIN';

CREATE TABLE "SchoolAdminAssignment" (
  "userId" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolAdminAssignment_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "SchoolAdminAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SchoolAdminAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SchoolAdminAssignment_schoolId_idx" ON "SchoolAdminAssignment"("schoolId");
