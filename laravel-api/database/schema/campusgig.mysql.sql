-- Generated from api/prisma/schema.prisma. Do not edit manually.
-- CreateTable
CREATE TABLE `User` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `avatarPath` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'PENDING',
    `lastSeenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `mfaEnabledAt` DATETIME(3) NULL,
    `mfaSecretCipher` VARCHAR(191) NULL,
    `mfaPendingSecretCipher` VARCHAR(191) NULL,
    `mfaLastUsedStep` BIGINT NULL,
    `sessionVersion` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupportTicket` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `category` ENUM('ACCOUNT', 'PAYMENT', 'ORDER', 'TECHNICAL', 'SAFETY', 'OTHER') NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `source` ENUM('WEB', 'MOBILE') NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `resolvedAt` DATETIME(3) NULL,

    INDEX `SupportTicket_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `SupportTicket_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthSession` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `clientType` ENUM('WEB', 'MOBILE') NOT NULL,
    `deviceName` VARCHAR(191) NOT NULL,
    `sessionVersion` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuthSession_userId_revokedAt_lastUsedAt_idx`(`userId`, `revokedAt`, `lastUsedAt`),
    INDEX `AuthSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` CHAR(36) NOT NULL,
    `sessionId` CHAR(36) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `RefreshToken_sessionId_usedAt_revokedAt_idx`(`sessionId`, `usedAt`, `revokedAt`),
    INDEX `RefreshToken_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MfaRecoveryCode` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MfaRecoveryCode_userId_usedAt_idx`(`userId`, `usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MfaChallenge` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MfaChallenge_tokenHash_key`(`tokenHash`),
    INDEX `MfaChallenge_userId_expiresAt_idx`(`userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrustedDevice` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TrustedDevice_tokenHash_key`(`tokenHash`),
    INDEX `TrustedDevice_userId_expiresAt_idx`(`userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordChangeRequest` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `newPasswordHash` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `expiresAt` DATETIME(3) NOT NULL,
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PasswordChangeRequest_tokenHash_key`(`tokenHash`),
    INDEX `PasswordChangeRequest_userId_status_expiresAt_idx`(`userId`, `status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SocialAccount` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `provider` ENUM('GOOGLE', 'FACEBOOK') NOT NULL,
    `providerUserId` VARCHAR(191) NOT NULL,
    `providerEmail` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SocialAccount_providerEmail_idx`(`providerEmail`),
    UNIQUE INDEX `SocialAccount_provider_providerUserId_key`(`provider`, `providerUserId`),
    UNIQUE INDEX `SocialAccount_userId_provider_key`(`userId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountCode` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `purpose` ENUM('VERIFY_EMAIL', 'RESET_PASSWORD') NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AccountCode_userId_purpose_createdAt_idx`(`userId`, `purpose`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderProfile` (
    `userId` CHAR(36) NOT NULL,
    `headline` VARCHAR(191) NOT NULL,
    `bio` TEXT NOT NULL,
    `skills` JSON NOT NULL,
    `isAvailable` BOOLEAN NOT NULL DEFAULT true,
    `maxActiveOrders` INTEGER NOT NULL DEFAULT 5,
    `maxPendingOrders` INTEGER NOT NULL DEFAULT 50,
    `instagramUrl` VARCHAR(191) NULL,
    `linkedinUrl` VARCHAR(191) NULL,
    `xUrl` VARCHAR(191) NULL,
    `portfolioUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserRoleAssignment` (
    `userId` CHAR(36) NOT NULL,
    `role` ENUM('CLIENT', 'STUDENT', 'PROVIDER', 'ORG_MEMBER', 'SCHOOL_ADMIN', 'ADMIN') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `School` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `shortName` VARCHAR(191) NOT NULL,
    `emailDomain` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(191) NOT NULL DEFAULT 'Lipa City',
    `status` ENUM('PENDING', 'ACTIVE', 'DISABLED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolAdminAssignment` (
    `userId` CHAR(36) NOT NULL,
    `schoolId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SchoolAdminAssignment_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StudentProfile` (
    `userId` CHAR(36) NOT NULL,
    `schoolId` CHAR(36) NOT NULL,
    `studentNumberCipher` VARCHAR(191) NULL,
    `program` VARCHAR(191) NULL,
    `yearLevel` INTEGER NULL,
    `bio` TEXT NULL,
    `verificationStatus` ENUM('UNSUBMITTED', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'UNSUBMITTED',
    `verifiedAt` DATETIME(3) NULL,
    `ratingAverage` DECIMAL(3, 2) NOT NULL DEFAULT 0,
    `reviewCount` INTEGER NOT NULL DEFAULT 0,
    `completedOrderCount` INTEGER NOT NULL DEFAULT 0,

    INDEX `StudentProfile_schoolId_verificationStatus_idx`(`schoolId`, `verificationStatus`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerificationRequest` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `schoolId` CHAR(36) NOT NULL,
    `studentIdFilePath` VARCHAR(191) NOT NULL,
    `status` ENUM('UNSUBMITTED', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedAt` DATETIME(3) NULL,
    `reviewedBy` CHAR(36) NULL,
    `rejectionReason` TEXT NULL,

    INDEX `VerificationRequest_status_submittedAt_idx`(`status`, `submittedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `icon` VARCHAR(191) NULL,
    `color` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Service` (
    `id` CHAR(36) NOT NULL,
    `providerId` CHAR(36) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `deliveryMethod` ENUM('ONLINE', 'IN_PERSON', 'HYBRID') NOT NULL DEFAULT 'ONLINE',
    `pricingModel` ENUM('LEGACY_PACKAGES', 'SINGLE_PRICE_V2') NOT NULL DEFAULT 'LEGACY_PACKAGES',
    `basePriceCentavos` INTEGER NULL,
    `normalDeliveryMinutes` INTEGER NULL,
    `includedRevisionLimit` INTEGER NULL,
    `acceptsRushOrders` BOOLEAN NOT NULL DEFAULT false,
    `fastestRushTier` ENUM('HOURS_24', 'HOURS_12', 'HOURS_6', 'HOURS_3') NULL,
    `campusLocation` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'REJECTED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedBy` CHAR(36) NULL,
    `rejectionReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Service_slug_key`(`slug`),
    INDEX `Service_status_categoryId_publishedAt_idx`(`status`, `categoryId`, `publishedAt`),
    INDEX `Service_providerId_status_idx`(`providerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SavedService` (
    `userId` CHAR(36) NOT NULL,
    `serviceId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SavedService_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`userId`, `serviceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServiceMedia` (
    `id` CHAR(36) NOT NULL,
    `serviceId` CHAR(36) NOT NULL,
    `kind` ENUM('COVER', 'PORTFOLIO') NOT NULL,
    `storagePath` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ServiceMedia_storagePath_key`(`storagePath`),
    INDEX `ServiceMedia_serviceId_kind_sortOrder_idx`(`serviceId`, `kind`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServicePackage` (
    `id` CHAR(36) NOT NULL,
    `serviceId` CHAR(36) NOT NULL,
    `tier` ENUM('BASIC', 'STANDARD', 'PREMIUM') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `priceCentavos` INTEGER NOT NULL,
    `deliveryDays` INTEGER NOT NULL,
    `revisionLimit` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `ServicePackage_serviceId_tier_key`(`serviceId`, `tier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` CHAR(36) NOT NULL,
    `orderNumber` VARCHAR(191) NOT NULL,
    `clientRequestId` CHAR(36) NULL,
    `requestFingerprint` VARCHAR(191) NULL,
    `clientId` CHAR(36) NOT NULL,
    `providerId` CHAR(36) NOT NULL,
    `serviceId` CHAR(36) NOT NULL,
    `servicePackageId` CHAR(36) NULL,
    `pricingModel` ENUM('LEGACY_PACKAGE_V1', 'SINGLE_PRICE_V2') NOT NULL DEFAULT 'LEGACY_PACKAGE_V1',
    `titleSnapshot` VARCHAR(191) NOT NULL,
    `packageSnapshot` JSON NULL,
    `termsSnapshot` JSON NOT NULL,
    `basePriceCentavos` INTEGER NULL,
    `rushSurchargeCentavos` INTEGER NULL,
    `deliveryOption` ENUM('NORMAL', 'RUSH_24_HOURS', 'RUSH_12_HOURS', 'RUSH_6_HOURS', 'RUSH_3_HOURS') NULL,
    `deliveryDurationMinutes` INTEGER NULL,
    `pricingPolicyVersion` INTEGER NULL,
    `platformFeeBasisPoints` INTEGER NULL,
    `rushBasisPoints` INTEGER NULL,
    `subtotalCentavos` INTEGER NOT NULL,
    `platformFeeCentavos` INTEGER NOT NULL DEFAULT 0,
    `totalCentavos` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'PHP',
    `requirements` TEXT NOT NULL,
    `dueAt` DATETIME(3) NULL,
    `status` ENUM('REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED', 'COMPLETED', 'CANCELLED', 'REJECTED') NOT NULL DEFAULT 'REQUESTED',
    `revisionLimit` INTEGER NOT NULL DEFAULT 0,
    `revisionsUsed` INTEGER NOT NULL DEFAULT 0,
    `acceptedAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `completionSource` ENUM('CLIENT_ACCEPTED', 'AUTO_REVIEW_TIMEOUT') NULL,
    `reviewPolicyVersion` INTEGER NULL,
    `reviewStartedAt` DATETIME(3) NULL,
    `reviewDeadlineAt` DATETIME(3) NULL,
    `reviewDeliverySubmissionId` CHAR(36) NULL,
    `clientArchivedAt` DATETIME(3) NULL,
    `clientRemovedAt` DATETIME(3) NULL,
    `providerArchivedAt` DATETIME(3) NULL,
    `providerRemovedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_orderNumber_key`(`orderNumber`),
    UNIQUE INDEX `Order_reviewDeliverySubmissionId_key`(`reviewDeliverySubmissionId`),
    INDEX `Order_clientId_status_createdAt_idx`(`clientId`, `status`, `createdAt`),
    INDEX `Order_providerId_status_createdAt_idx`(`providerId`, `status`, `createdAt`),
    INDEX `Order_status_reviewDeadlineAt_id_idx`(`status`, `reviewDeadlineAt`, `id`),
    INDEX `Order_clientId_clientRemovedAt_clientArchivedAt_createdAt_id_id`(`clientId`, `clientRemovedAt`, `clientArchivedAt`, `createdAt`, `id`),
    INDEX `Order_providerId_providerRemovedAt_providerArchivedAt_createdAt`(`providerId`, `providerRemovedAt`, `providerArchivedAt`, `createdAt`, `id`),
    UNIQUE INDEX `Order_clientId_clientRequestId_key`(`clientId`, `clientRequestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderDispute` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `openedById` CHAR(36) NOT NULL,
    `reason` ENUM('SERVICE_NOT_DELIVERED', 'QUALITY_ISSUE', 'REQUIREMENTS_MISMATCH', 'PAYMENT_ISSUE', 'CONDUCT', 'OTHER') NOT NULL,
    `details` TEXT NOT NULL,
    `status` ENUM('OPEN', 'WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'RESOLVED_CLIENT', 'RESOLVED_PROVIDER', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `targetDeliverySubmissionId` CHAR(36) NULL,
    `targetRevisionRequestId` CHAR(36) NULL,
    `targetRevisionPurchaseId` CHAR(36) NULL,
    `responseRequestedFrom` ENUM('CLIENT', 'PROVIDER') NULL,
    `responseRequestedAt` DATETIME(3) NULL,
    `responseDeadlineAt` DATETIME(3) NULL,
    `responseRequestSequence` INTEGER NOT NULL DEFAULT 0,
    `reviewPausedAt` DATETIME(3) NULL,
    `reviewRemainingSeconds` INTEGER NULL,
    `readyForReviewAt` DATETIME(3) NULL,
    `reviewStartedAt` DATETIME(3) NULL,
    `resolutionNote` TEXT NULL,
    `resolvedById` CHAR(36) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `OrderDispute_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `OrderDispute_orderId_createdAt_idx`(`orderId`, `createdAt`),
    INDEX `OrderDispute_status_responseDeadlineAt_id_idx`(`status`, `responseDeadlineAt`, `id`),
    INDEX `OrderDispute_targetDeliverySubmissionId_idx`(`targetDeliverySubmissionId`),
    INDEX `OrderDispute_targetRevisionRequestId_idx`(`targetRevisionRequestId`),
    INDEX `OrderDispute_targetRevisionPurchaseId_idx`(`targetRevisionPurchaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DisputeAffectedEarning` (
    `id` CHAR(36) NOT NULL,
    `disputeId` CHAR(36) NOT NULL,
    `providerEarningId` CHAR(36) NOT NULL,
    `preFreezeStatus` ENUM('PENDING', 'AVAILABLE', 'FROZEN', 'PAYOUT_PROCESSING', 'PAID_OUT', 'REFUNDED') NOT NULL,
    `frozenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `restoredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DisputeAffectedEarning_providerEarningId_createdAt_idx`(`providerEarningId`, `createdAt`),
    UNIQUE INDEX `DisputeAffectedEarning_disputeId_providerEarningId_key`(`disputeId`, `providerEarningId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DisputeResponse` (
    `id` CHAR(36) NOT NULL,
    `disputeId` CHAR(36) NOT NULL,
    `responderId` CHAR(36) NOT NULL,
    `requestedFrom` ENUM('CLIENT', 'PROVIDER') NOT NULL,
    `requestSequence` INTEGER NOT NULL,
    `details` TEXT NOT NULL,
    `responseRequestedAt` DATETIME(3) NOT NULL,
    `responseDeadlineAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DisputeResponse_responderId_createdAt_idx`(`responderId`, `createdAt`),
    UNIQUE INDEX `DisputeResponse_disputeId_requestSequence_key`(`disputeId`, `requestSequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DisputeEvidence` (
    `id` CHAR(36) NOT NULL,
    `disputeId` CHAR(36) NOT NULL,
    `responseId` CHAR(36) NULL,
    `submittedById` CHAR(36) NOT NULL,
    `storagePath` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `checksum` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DisputeEvidence_storagePath_key`(`storagePath`),
    INDEX `DisputeEvidence_disputeId_createdAt_idx`(`disputeId`, `createdAt`),
    INDEX `DisputeEvidence_responseId_createdAt_idx`(`responseId`, `createdAt`),
    INDEX `DisputeEvidence_submittedById_createdAt_idx`(`submittedById`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DisputeTimelineEvent` (
    `id` CHAR(36) NOT NULL,
    `disputeId` CHAR(36) NOT NULL,
    `actorId` CHAR(36) NULL,
    `type` ENUM('OPENED', 'EVIDENCE_ADDED', 'RESPONSE_REQUESTED', 'RESPONSE_SUBMITTED', 'RESPONSE_DEADLINE_EXPIRED', 'READY_FOR_REVIEW', 'REVIEW_STARTED', 'RESOLVED_CLIENT', 'RESOLVED_PROVIDER', 'CLOSED') NOT NULL,
    `details` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DisputeTimelineEvent_disputeId_createdAt_idx`(`disputeId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `provider` ENUM('PAYMONGO') NOT NULL DEFAULT 'PAYMONGO',
    `providerPaymentId` VARCHAR(191) NULL,
    `providerCheckoutId` VARCHAR(191) NULL,
    `checkoutUrl` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `amountCentavos` INTEGER NOT NULL,
    `platformFeeCentavos` INTEGER NOT NULL,
    `providerNetCentavos` INTEGER NOT NULL,
    `refundedCentavos` INTEGER NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'PHP',
    `status` ENUM('PENDING', 'REQUIRES_ACTION', 'PAID', 'FAILED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `failureCode` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payment_providerPaymentId_key`(`providerPaymentId`),
    UNIQUE INDEX `Payment_providerCheckoutId_key`(`providerCheckoutId`),
    UNIQUE INDEX `Payment_idempotencyKey_key`(`idempotencyKey`),
    INDEX `Payment_orderId_status_createdAt_idx`(`orderId`, `status`, `createdAt`),
    INDEX `Payment_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentRefund` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NULL,
    `paymentId` CHAR(36) NULL,
    `revisionPurchaseId` CHAR(36) NULL,
    `providerEarningId` CHAR(36) NULL,
    `triggeringDisputeId` CHAR(36) NULL,
    `requestedById` CHAR(36) NULL,
    `sourceType` ENUM('ORIGINAL_ORDER', 'PAID_EXTRA_REVISION') NULL,
    `reasonCode` ENUM('PAID_NOT_STARTED', 'MISSED_RUSH_DEADLINE', 'DISPUTE_CLIENT_WIN', 'STALE_REVISION_PAYMENT', 'ADMIN_EXCEPTION') NULL,
    `requestOrigin` ENUM('CLIENT', 'ADMIN', 'SYSTEM') NULL,
    `preRefundEarningStatus` ENUM('PENDING', 'AVAILABLE', 'FROZEN', 'PAYOUT_PROCESSING', 'PAID_OUT', 'REFUNDED') NULL,
    `sourceKey` VARCHAR(191) NULL,
    `providerRefundId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `providerPrincipalCentavos` INTEGER NULL,
    `platformFeeCentavos` INTEGER NULL,
    `refundTotalCentavos` INTEGER NULL,
    `amountCentavos` INTEGER NOT NULL,
    `currency` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NOT NULL,
    `status` ENUM('REQUESTED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'RECONCILIATION_REQUIRED') NOT NULL DEFAULT 'REQUESTED',
    `providerStatus` VARCHAR(191) NULL,
    `failureCode` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `submittedAt` DATETIME(3) NULL,
    `processedAt` DATETIME(3) NULL,
    `reconciliationRequiredAt` DATETIME(3) NULL,
    `accountingReversedAt` DATETIME(3) NULL,
    `providerPrincipalReversedCentavos` INTEGER NOT NULL DEFAULT 0,
    `platformFeeReversedCentavos` INTEGER NOT NULL DEFAULT 0,
    `providerCreatedAt` DATETIME(3) NULL,
    `providerUpdatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentRefund_sourceKey_key`(`sourceKey`),
    UNIQUE INDEX `PaymentRefund_providerRefundId_key`(`providerRefundId`),
    UNIQUE INDEX `PaymentRefund_idempotencyKey_key`(`idempotencyKey`),
    INDEX `PaymentRefund_paymentId_status_createdAt_idx`(`paymentId`, `status`, `createdAt`),
    INDEX `PaymentRefund_revisionPurchaseId_status_createdAt_idx`(`revisionPurchaseId`, `status`, `createdAt`),
    INDEX `PaymentRefund_orderId_status_createdAt_idx`(`orderId`, `status`, `createdAt`),
    INDEX `PaymentRefund_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `PaymentRefund_triggeringDisputeId_idx`(`triggeringDisputeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformFeeLedgerEntry` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `refundId` CHAR(36) NOT NULL,
    `type` ENUM('REFUND_REVERSAL') NOT NULL,
    `amountCentavos` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PlatformFeeLedgerEntry_refundId_key`(`refundId`),
    UNIQUE INDEX `PlatformFeeLedgerEntry_sourceKey_key`(`sourceKey`),
    INDEX `PlatformFeeLedgerEntry_orderId_createdAt_idx`(`orderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderEarning` (
    `id` CHAR(36) NOT NULL,
    `providerId` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `paymentId` CHAR(36) NULL,
    `revisionPurchaseId` CHAR(36) NULL,
    `sourceType` ENUM('ORIGINAL_ORDER', 'PAID_EXTRA_REVISION') NOT NULL DEFAULT 'ORIGINAL_ORDER',
    `currency` VARCHAR(191) NOT NULL,
    `grossServiceAmountCentavos` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'AVAILABLE', 'FROZEN', 'PAYOUT_PROCESSING', 'PAID_OUT', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `pendingAt` DATETIME(3) NOT NULL,
    `availableAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProviderEarning_paymentId_key`(`paymentId`),
    UNIQUE INDEX `ProviderEarning_revisionPurchaseId_key`(`revisionPurchaseId`),
    INDEX `ProviderEarning_providerId_status_createdAt_idx`(`providerId`, `status`, `createdAt`),
    INDEX `ProviderEarning_providerId_createdAt_idx`(`providerId`, `createdAt`),
    INDEX `ProviderEarning_orderId_sourceType_createdAt_idx`(`orderId`, `sourceType`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderEarningLedgerEntry` (
    `id` CHAR(36) NOT NULL,
    `providerEarningId` CHAR(36) NOT NULL,
    `providerId` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `sourcePaymentId` CHAR(36) NULL,
    `sourceRevisionPurchaseId` CHAR(36) NULL,
    `type` ENUM('EARNING_PENDING_CREDIT', 'EARNING_AVAILABLE_RELEASE', 'EARNING_FROZEN', 'EARNING_UNFROZEN', 'EARNING_REFUND_REVERSAL', 'EARNING_PAYOUT_RESERVED', 'EARNING_PAYOUT_RELEASED', 'EARNING_PAID_OUT') NOT NULL,
    `amountCentavos` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProviderEarningLedgerEntry_sourcePaymentId_key`(`sourcePaymentId`),
    UNIQUE INDEX `ProviderEarningLedgerEntry_sourceRevisionPurchaseId_key`(`sourceRevisionPurchaseId`),
    UNIQUE INDEX `ProviderEarningLedgerEntry_sourceKey_key`(`sourceKey`),
    INDEX `ProviderEarningLedgerEntry_providerEarningId_createdAt_idx`(`providerEarningId`, `createdAt`),
    INDEX `ProviderEarningLedgerEntry_providerId_createdAt_idx`(`providerId`, `createdAt`),
    INDEX `ProviderEarningLedgerEntry_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderPayoutDestination` (
    `id` CHAR(36) NOT NULL,
    `providerId` CHAR(36) NOT NULL,
    `type` ENUM('BANK_ACCOUNT', 'E_WALLET') NOT NULL,
    `displayLabel` VARCHAR(191) NOT NULL,
    `maskedAccountIdentifier` VARCHAR(191) NOT NULL,
    `accountHolderName` VARCHAR(191) NOT NULL,
    `providerAdapterKey` VARCHAR(191) NULL,
    `externalReferenceToken` TEXT NULL,
    `verificationStatus` ENUM('UNVERIFIED', 'ADMIN_REVIEWED', 'PROVIDER_VERIFIED') NOT NULL DEFAULT 'UNVERIFIED',
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PayoutDestination_provider_type_mask_idx`(`providerId`, `type`, `maskedAccountIdentifier`),
    INDEX `ProviderPayoutDestination_providerId_isActive_createdAt_idx`(`providerId`, `isActive`, `createdAt`),
    INDEX `ProviderPayoutDestination_verificationStatus_createdAt_idx`(`verificationStatus`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderPayout` (
    `id` CHAR(36) NOT NULL,
    `providerId` CHAR(36) NOT NULL,
    `destinationId` CHAR(36) NOT NULL,
    `clientRequestId` CHAR(36) NOT NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `requestedPrincipalCentavos` INTEGER NOT NULL,
    `eligiblePrincipalCentavos` INTEGER NOT NULL,
    `payoutFeeCentavos` INTEGER NOT NULL DEFAULT 0,
    `netDisbursementCentavos` INTEGER NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'REJECTED', 'CANCELLED', 'RECONCILIATION_REQUIRED') NOT NULL DEFAULT 'REQUESTED',
    `destinationSnapshot` JSON NOT NULL,
    `settlementMethod` ENUM('MANUAL', 'EXTERNAL_PROVIDER') NULL,
    `providerAdapterKey` VARCHAR(191) NULL,
    `externalPayoutId` VARCHAR(191) NULL,
    `externalStatus` VARCHAR(191) NULL,
    `failureCode` VARCHAR(191) NULL,
    `reconciliationContext` TEXT NULL,
    `approvedById` CHAR(36) NULL,
    `settledById` CHAR(36) NULL,
    `manualSettlementReference` VARCHAR(191) NULL,
    `settlementNote` TEXT NULL,
    `settlementAt` DATETIME(3) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedAt` DATETIME(3) NULL,
    `processingAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `reconciliationRequiredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProviderPayout_sourceKey_key`(`sourceKey`),
    UNIQUE INDEX `ProviderPayout_externalPayoutId_key`(`externalPayoutId`),
    UNIQUE INDEX `ProviderPayout_manualSettlementReference_key`(`manualSettlementReference`),
    INDEX `ProviderPayout_providerId_status_requestedAt_idx`(`providerId`, `status`, `requestedAt`),
    INDEX `ProviderPayout_status_requestedAt_idx`(`status`, `requestedAt`),
    INDEX `ProviderPayout_destinationId_requestedAt_idx`(`destinationId`, `requestedAt`),
    UNIQUE INDEX `ProviderPayout_providerId_clientRequestId_key`(`providerId`, `clientRequestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderPayoutItem` (
    `id` CHAR(36) NOT NULL,
    `payoutId` CHAR(36) NOT NULL,
    `providerEarningId` CHAR(36) NOT NULL,
    `principalCentavos` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `reservationActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProviderPayoutItem_providerEarningId_reservationActive_idx`(`providerEarningId`, `reservationActive`),
    UNIQUE INDEX `ProviderPayoutItem_payoutId_providerEarningId_key`(`payoutId`, `providerEarningId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderPayoutAudit` (
    `id` CHAR(36) NOT NULL,
    `payoutId` CHAR(36) NOT NULL,
    `actorId` CHAR(36) NULL,
    `action` ENUM('REQUESTED', 'CANCELLED', 'APPROVED', 'REJECTED', 'PROCESSING', 'MANUAL_SETTLED', 'EXTERNAL_RECONCILED', 'FAILED', 'RECONCILIATION_REQUIRED') NOT NULL,
    `context` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProviderPayoutAudit_payoutId_createdAt_idx`(`payoutId`, `createdAt`),
    INDEX `ProviderPayoutAudit_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentWebhookEvent` (
    `id` CHAR(36) NOT NULL,
    `provider` ENUM('PAYMONGO') NOT NULL DEFAULT 'PAYMONGO',
    `providerEventId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `processedAt` DATETIME(3) NULL,
    `processingError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PaymentWebhookEvent_processedAt_createdAt_idx`(`processedAt`, `createdAt`),
    UNIQUE INDEX `PaymentWebhookEvent_provider_providerEventId_key`(`provider`, `providerEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` CHAR(36) NOT NULL,
    `recipientId` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NULL,
    `conversationId` CHAR(36) NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_recipientId_readAt_createdAt_idx`(`recipientId`, `readAt`, `createdAt`),
    INDEX `Notification_conversationId_recipientId_readAt_idx`(`conversationId`, `recipientId`, `readAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderStatusHistory` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `fromStatus` ENUM('REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED', 'COMPLETED', 'CANCELLED', 'REJECTED') NULL,
    `toStatus` ENUM('REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED', 'COMPLETED', 'CANCELLED', 'REJECTED') NOT NULL,
    `changedBy` CHAR(36) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderStatusHistory_orderId_createdAt_idx`(`orderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderFile` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `deliverySubmissionId` CHAR(36) NULL,
    `uploadedBy` CHAR(36) NOT NULL,
    `purpose` ENUM('REQUIREMENT', 'MESSAGE_ATTACHMENT', 'DELIVERABLE', 'REVISION') NOT NULL,
    `storagePath` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `checksum` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OrderFile_storagePath_key`(`storagePath`),
    INDEX `OrderFile_deliverySubmissionId_idx`(`deliverySubmissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliverySubmission` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `providerId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `note` TEXT NULL,
    `clientRequestId` CHAR(36) NULL,
    `requestFingerprint` VARCHAR(191) NULL,
    `revisionRequestId` CHAR(36) NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DeliverySubmission_revisionRequestId_key`(`revisionRequestId`),
    INDEX `DeliverySubmission_providerId_submittedAt_idx`(`providerId`, `submittedAt`),
    UNIQUE INDEX `DeliverySubmission_orderId_version_key`(`orderId`, `version`),
    UNIQUE INDEX `DeliverySubmission_orderId_clientRequestId_key`(`orderId`, `clientRequestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryFileAccessAudit` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `deliverySubmissionId` CHAR(36) NOT NULL,
    `fileId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `accessType` ENUM('ACCESS_GRANTED') NOT NULL DEFAULT 'ACCESS_GRANTED',
    `accessedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DeliveryFileAccessAudit_orderId_accessedAt_idx`(`orderId`, `accessedAt`),
    INDEX `DeliveryFileAccessAudit_deliverySubmissionId_accessedAt_idx`(`deliverySubmissionId`, `accessedAt`),
    INDEX `DeliveryFileAccessAudit_fileId_accessedAt_idx`(`fileId`, `accessedAt`),
    INDEX `DeliveryFileAccessAudit_userId_accessedAt_idx`(`userId`, `accessedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` CHAR(36) NOT NULL,
    `kind` ENUM('ORDER', 'INQUIRY') NOT NULL DEFAULT 'ORDER',
    `orderId` CHAR(36) NULL,
    `clientId` CHAR(36) NULL,
    `providerId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Conversation_orderId_key`(`orderId`),
    INDEX `Conversation_providerId_createdAt_idx`(`providerId`, `createdAt`),
    UNIQUE INDEX `Conversation_clientId_providerId_key`(`clientId`, `providerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationParticipant` (
    `conversationId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `lastReadMessageId` CHAR(36) NULL,
    `lastReadAt` DATETIME(3) NULL,
    `hiddenAt` DATETIME(3) NULL,
    `pinnedAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,

    PRIMARY KEY (`conversationId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` CHAR(36) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `senderId` CHAR(36) NOT NULL,
    `body` TEXT NULL,
    `messageType` ENUM('TEXT', 'FILE', 'SYSTEM') NOT NULL DEFAULT 'TEXT',
    `replyToId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Message_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageAttachment` (
    `messageId` CHAR(36) NOT NULL,
    `orderFileId` CHAR(36) NOT NULL,

    PRIMARY KEY (`messageId`, `orderFileId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RevisionRequest` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `requestedBy` CHAR(36) NOT NULL,
    `sequenceNumber` INTEGER NOT NULL,
    `type` ENUM('PROVIDER_CORRECTION', 'INCLUDED', 'PAID_EXTRA') NULL,
    `instructions` TEXT NOT NULL,
    `status` ENUM('AWAITING_PROVIDER_ACKNOWLEDGEMENT', 'OPEN', 'DECLINED', 'RESOLVED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `sourceDeliverySubmissionId` CHAR(36) NULL,
    `revisionDeadlineAt` DATETIME(3) NULL,
    `turnaroundMinutes` INTEGER NULL,
    `providerAcknowledgedAt` DATETIME(3) NULL,
    `declinedAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RevisionRequest_orderId_status_createdAt_idx`(`orderId`, `status`, `createdAt`),
    INDEX `RevisionRequest_sourceDeliverySubmissionId_createdAt_idx`(`sourceDeliverySubmissionId`, `createdAt`),
    UNIQUE INDEX `RevisionRequest_orderId_sequenceNumber_key`(`orderId`, `sequenceNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderRevisionPurchase` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `sourceDeliverySubmissionId` CHAR(36) NOT NULL,
    `clientId` CHAR(36) NOT NULL,
    `providerId` CHAR(36) NOT NULL,
    `revisionRequestId` CHAR(36) NULL,
    `instructions` TEXT NOT NULL,
    `providerSubtotalCentavos` INTEGER NOT NULL,
    `platformFeeCentavos` INTEGER NOT NULL,
    `totalCentavos` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `turnaroundMinutes` INTEGER NOT NULL,
    `pricingPolicyVersion` INTEGER NOT NULL,
    `pricingBasisCentavos` INTEGER NOT NULL,
    `deliveryDurationBasisMinutes` INTEGER NOT NULL,
    `providerPaymentId` VARCHAR(191) NULL,
    `providerCheckoutId` VARCHAR(191) NULL,
    `checkoutUrl` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `paymentStatus` ENUM('PENDING', 'REQUIRES_ACTION', 'PAID', 'FAILED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `activationStatus` ENUM('PENDING', 'ACTIVATED', 'RECONCILIATION_REQUIRED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `failureCode` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `activatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `refundedCentavos` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `OrderRevisionPurchase_revisionRequestId_key`(`revisionRequestId`),
    UNIQUE INDEX `OrderRevisionPurchase_providerPaymentId_key`(`providerPaymentId`),
    UNIQUE INDEX `OrderRevisionPurchase_providerCheckoutId_key`(`providerCheckoutId`),
    UNIQUE INDEX `OrderRevisionPurchase_idempotencyKey_key`(`idempotencyKey`),
    INDEX `OrderRevisionPurchase_orderId_createdAt_idx`(`orderId`, `createdAt`),
    INDEX `OrderRevisionPurchase_sourceDeliverySubmissionId_paymentSta_idx`(`sourceDeliverySubmissionId`, `paymentStatus`),
    INDEX `OrderRevisionPurchase_paymentStatus_createdAt_idx`(`paymentStatus`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Review` (
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `reviewerId` CHAR(36) NOT NULL,
    `revieweeId` CHAR(36) NOT NULL,
    `overallRating` INTEGER NOT NULL,
    `qualityRating` INTEGER NULL,
    `communicationRating` INTEGER NULL,
    `timelinessRating` INTEGER NULL,
    `comment` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Review_orderId_key`(`orderId`),
    INDEX `Review_revieweeId_createdAt_idx`(`revieweeId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SupportTicket` ADD CONSTRAINT `SupportTicket_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthSession` ADD CONSTRAINT `AuthSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `AuthSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MfaRecoveryCode` ADD CONSTRAINT `MfaRecoveryCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MfaChallenge` ADD CONSTRAINT `MfaChallenge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrustedDevice` ADD CONSTRAINT `TrustedDevice_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordChangeRequest` ADD CONSTRAINT `PasswordChangeRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SocialAccount` ADD CONSTRAINT `SocialAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountCode` ADD CONSTRAINT `AccountCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderProfile` ADD CONSTRAINT `ProviderProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserRoleAssignment` ADD CONSTRAINT `UserRoleAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolAdminAssignment` ADD CONSTRAINT `SchoolAdminAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolAdminAssignment` ADD CONSTRAINT `SchoolAdminAssignment_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentProfile` ADD CONSTRAINT `StudentProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentProfile` ADD CONSTRAINT `StudentProfile_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationRequest` ADD CONSTRAINT `VerificationRequest_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Service` ADD CONSTRAINT `Service_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Service` ADD CONSTRAINT `Service_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SavedService` ADD CONSTRAINT `SavedService_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SavedService` ADD CONSTRAINT `SavedService_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceMedia` ADD CONSTRAINT `ServiceMedia_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServicePackage` ADD CONSTRAINT `ServicePackage_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_servicePackageId_fkey` FOREIGN KEY (`servicePackageId`) REFERENCES `ServicePackage`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_reviewDeliverySubmissionId_fkey` FOREIGN KEY (`reviewDeliverySubmissionId`) REFERENCES `DeliverySubmission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderDispute` ADD CONSTRAINT `OrderDispute_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderDispute` ADD CONSTRAINT `OrderDispute_openedById_fkey` FOREIGN KEY (`openedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderDispute` ADD CONSTRAINT `OrderDispute_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderDispute` ADD CONSTRAINT `OrderDispute_targetDeliverySubmissionId_fkey` FOREIGN KEY (`targetDeliverySubmissionId`) REFERENCES `DeliverySubmission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderDispute` ADD CONSTRAINT `OrderDispute_targetRevisionRequestId_fkey` FOREIGN KEY (`targetRevisionRequestId`) REFERENCES `RevisionRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderDispute` ADD CONSTRAINT `OrderDispute_targetRevisionPurchaseId_fkey` FOREIGN KEY (`targetRevisionPurchaseId`) REFERENCES `OrderRevisionPurchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisputeAffectedEarning` ADD CONSTRAINT `DisputeAffectedEarning_disputeId_fkey` FOREIGN KEY (`disputeId`) REFERENCES `OrderDispute`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisputeAffectedEarning` ADD CONSTRAINT `DisputeAffectedEarning_providerEarningId_fkey` FOREIGN KEY (`providerEarningId`) REFERENCES `ProviderEarning`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisputeResponse` ADD CONSTRAINT `DisputeResponse_disputeId_fkey` FOREIGN KEY (`disputeId`) REFERENCES `OrderDispute`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisputeResponse` ADD CONSTRAINT `DisputeResponse_responderId_fkey` FOREIGN KEY (`responderId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisputeEvidence` ADD CONSTRAINT `DisputeEvidence_disputeId_fkey` FOREIGN KEY (`disputeId`) REFERENCES `OrderDispute`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisputeEvidence` ADD CONSTRAINT `DisputeEvidence_responseId_fkey` FOREIGN KEY (`responseId`) REFERENCES `DisputeResponse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisputeEvidence` ADD CONSTRAINT `DisputeEvidence_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisputeTimelineEvent` ADD CONSTRAINT `DisputeTimelineEvent_disputeId_fkey` FOREIGN KEY (`disputeId`) REFERENCES `OrderDispute`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisputeTimelineEvent` ADD CONSTRAINT `DisputeTimelineEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRefund` ADD CONSTRAINT `PaymentRefund_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRefund` ADD CONSTRAINT `PaymentRefund_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRefund` ADD CONSTRAINT `PaymentRefund_revisionPurchaseId_fkey` FOREIGN KEY (`revisionPurchaseId`) REFERENCES `OrderRevisionPurchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRefund` ADD CONSTRAINT `PaymentRefund_providerEarningId_fkey` FOREIGN KEY (`providerEarningId`) REFERENCES `ProviderEarning`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRefund` ADD CONSTRAINT `PaymentRefund_triggeringDisputeId_fkey` FOREIGN KEY (`triggeringDisputeId`) REFERENCES `OrderDispute`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRefund` ADD CONSTRAINT `PaymentRefund_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformFeeLedgerEntry` ADD CONSTRAINT `PlatformFeeLedgerEntry_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformFeeLedgerEntry` ADD CONSTRAINT `PlatformFeeLedgerEntry_refundId_fkey` FOREIGN KEY (`refundId`) REFERENCES `PaymentRefund`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEarning` ADD CONSTRAINT `ProviderEarning_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEarning` ADD CONSTRAINT `ProviderEarning_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEarning` ADD CONSTRAINT `ProviderEarning_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEarning` ADD CONSTRAINT `ProviderEarning_revisionPurchaseId_fkey` FOREIGN KEY (`revisionPurchaseId`) REFERENCES `OrderRevisionPurchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEarningLedgerEntry` ADD CONSTRAINT `ProviderEarningLedgerEntry_providerEarningId_fkey` FOREIGN KEY (`providerEarningId`) REFERENCES `ProviderEarning`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEarningLedgerEntry` ADD CONSTRAINT `ProviderEarningLedgerEntry_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEarningLedgerEntry` ADD CONSTRAINT `ProviderEarningLedgerEntry_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEarningLedgerEntry` ADD CONSTRAINT `ProviderEarningLedgerEntry_sourcePaymentId_fkey` FOREIGN KEY (`sourcePaymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEarningLedgerEntry` ADD CONSTRAINT `ProviderEarningLedgerEntry_sourceRevisionPurchaseId_fkey` FOREIGN KEY (`sourceRevisionPurchaseId`) REFERENCES `OrderRevisionPurchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderPayoutDestination` ADD CONSTRAINT `ProviderPayoutDestination_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderPayoutDestination` ADD CONSTRAINT `ProviderPayoutDestination_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderPayout` ADD CONSTRAINT `ProviderPayout_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderPayout` ADD CONSTRAINT `ProviderPayout_destinationId_fkey` FOREIGN KEY (`destinationId`) REFERENCES `ProviderPayoutDestination`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderPayout` ADD CONSTRAINT `ProviderPayout_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderPayout` ADD CONSTRAINT `ProviderPayout_settledById_fkey` FOREIGN KEY (`settledById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderPayoutItem` ADD CONSTRAINT `ProviderPayoutItem_payoutId_fkey` FOREIGN KEY (`payoutId`) REFERENCES `ProviderPayout`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderPayoutItem` ADD CONSTRAINT `ProviderPayoutItem_providerEarningId_fkey` FOREIGN KEY (`providerEarningId`) REFERENCES `ProviderEarning`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderPayoutAudit` ADD CONSTRAINT `ProviderPayoutAudit_payoutId_fkey` FOREIGN KEY (`payoutId`) REFERENCES `ProviderPayout`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderPayoutAudit` ADD CONSTRAINT `ProviderPayoutAudit_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderStatusHistory` ADD CONSTRAINT `OrderStatusHistory_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderStatusHistory` ADD CONSTRAINT `OrderStatusHistory_changedBy_fkey` FOREIGN KEY (`changedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderFile` ADD CONSTRAINT `OrderFile_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderFile` ADD CONSTRAINT `OrderFile_deliverySubmissionId_fkey` FOREIGN KEY (`deliverySubmissionId`) REFERENCES `DeliverySubmission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderFile` ADD CONSTRAINT `OrderFile_uploadedBy_fkey` FOREIGN KEY (`uploadedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliverySubmission` ADD CONSTRAINT `DeliverySubmission_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliverySubmission` ADD CONSTRAINT `DeliverySubmission_revisionRequestId_fkey` FOREIGN KEY (`revisionRequestId`) REFERENCES `RevisionRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliverySubmission` ADD CONSTRAINT `DeliverySubmission_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryFileAccessAudit` ADD CONSTRAINT `DeliveryFileAccessAudit_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryFileAccessAudit` ADD CONSTRAINT `DeliveryFileAccessAudit_deliverySubmissionId_fkey` FOREIGN KEY (`deliverySubmissionId`) REFERENCES `DeliverySubmission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryFileAccessAudit` ADD CONSTRAINT `DeliveryFileAccessAudit_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `OrderFile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryFileAccessAudit` ADD CONSTRAINT `DeliveryFileAccessAudit_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationParticipant` ADD CONSTRAINT `ConversationParticipant_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationParticipant` ADD CONSTRAINT `ConversationParticipant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_replyToId_fkey` FOREIGN KEY (`replyToId`) REFERENCES `Message`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageAttachment` ADD CONSTRAINT `MessageAttachment_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageAttachment` ADD CONSTRAINT `MessageAttachment_orderFileId_fkey` FOREIGN KEY (`orderFileId`) REFERENCES `OrderFile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RevisionRequest` ADD CONSTRAINT `RevisionRequest_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RevisionRequest` ADD CONSTRAINT `RevisionRequest_requestedBy_fkey` FOREIGN KEY (`requestedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RevisionRequest` ADD CONSTRAINT `RevisionRequest_sourceDeliverySubmissionId_fkey` FOREIGN KEY (`sourceDeliverySubmissionId`) REFERENCES `DeliverySubmission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderRevisionPurchase` ADD CONSTRAINT `OrderRevisionPurchase_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderRevisionPurchase` ADD CONSTRAINT `OrderRevisionPurchase_sourceDeliverySubmissionId_fkey` FOREIGN KEY (`sourceDeliverySubmissionId`) REFERENCES `DeliverySubmission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderRevisionPurchase` ADD CONSTRAINT `OrderRevisionPurchase_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderRevisionPurchase` ADD CONSTRAINT `OrderRevisionPurchase_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderRevisionPurchase` ADD CONSTRAINT `OrderRevisionPurchase_revisionRequestId_fkey` FOREIGN KEY (`revisionRequestId`) REFERENCES `RevisionRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_revieweeId_fkey` FOREIGN KEY (`revieweeId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

