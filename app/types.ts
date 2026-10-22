export type Category = {
  id: string;
  name: string;
  serviceCount: number;
  icon?: string;
  color?: string;
};

export type ServicePackage = {
  id: string;
  tier: "BASIC" | "STANDARD" | "PREMIUM";
  name: string;
  description: string;
  priceCentavos: number;
  deliveryDays: number;
  revisionLimit: number;
};

export type ServicePricingModel =
  | "LEGACY_PACKAGES"
  | "SINGLE_PRICE_V2"
  | (string & {});

export type OrderPricingModel =
  | "LEGACY_PACKAGE_V1"
  | "SINGLE_PRICE_V2"
  | (string & {});

export type RushTier = "HOURS_24" | "HOURS_12" | "HOURS_6" | "HOURS_3";
export type DeliveryOption =
  | "NORMAL"
  | "RUSH_24_HOURS"
  | "RUSH_12_HOURS"
  | "RUSH_6_HOURS"
  | "RUSH_3_HOURS";
export type MarketplaceQuote = {
  pricingModel: "SINGLE_PRICE_V2";
  currency: "PHP";
  basePriceCentavos: number;
  deliveryOption: DeliveryOption;
  deliveryDurationMinutes: number;
  rushSurchargeCentavos: number;
  providerServiceSubtotalCentavos: number;
  platformFeeCentavos: number;
  clientTotalCentavos: number;
  platformFeeBasisPoints: number;
  rushBasisPoints: number;
  pricingPolicyVersion: number;
  eligibleDeliveryOptions: DeliveryOption[];
};

export type Service = {
  id: string;
  pricingModel?: ServicePricingModel;
  basePriceCentavos?: number | null;
  normalDeliveryMinutes?: number | null;
  includedRevisionLimit?: number | null;
  acceptsRushOrders?: boolean;
  fastestRushTier?: RushTier | null;
  title: string;
  providerId: string;
  provider: string;
  providerHasAvatar: boolean;
  providerAvatarVersion: number;
  initials: string;
  program: string;
  school: string;
  schoolId: string;
  category: string;
  price: number;
  rating: number;
  reviews: number;
  acceptingOrders: boolean;
  delivery: string;
  publishedAt: string;
  color?: string;
  icon?: string;
  description: string;
  packages: ServicePackage[];
  coverMediaId?: string | null;
  portfolio?: { id: string; originalName: string; mimeType: string }[];
};

export type ServicePage = {
  data: Service[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

export type PublicProviderProfile = {
  id: string;
  displayName: string;
  hasAvatar: boolean;
  avatarVersion: number;
  memberSince: string;
  headline: string;
  bio: string;
  skills: string[];
  isAvailable: boolean;
  socialLinks: ProviderSocialLinks;
  verified: boolean;
  program: string | null;
  school: Pick<School, "id" | "name" | "shortName" | "city">;
  rating: number;
  reviewCount: number;
  completedOrders: number;
  services: Service[];
};

export type ProviderSocialLinks = {
  instagram: string | null;
  linkedin: string | null;
  x: string | null;
  portfolio: string | null;
};

export type PublicProviderReview = {
  id: string;
  overallRating: number;
  qualityRating: number | null;
  communicationRating: number | null;
  timelinessRating: number | null;
  comment: string | null;
  createdAt: string;
  reviewerLabel: string;
  serviceTitle: string;
};

export type PublicProviderReviews = {
  data: PublicProviderReview[];
  summary: {
    average: number;
    total: number;
    distribution: { rating: number; count: number }[];
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type School = {
  id: string;
  name: string;
  shortName: string;
  city: string;
  status?: "PENDING" | "ACTIVE" | "DISABLED";
  emailDomain?: string | null;
  address?: string | null;
};

export type Order = {
  id: string;
  service: string;
  client: string;
  amount: number;
  status: string;
  due: string;
};

export type Verification = {
  id: string;
  userId: string;
  name: string;
  email?: string;
  school: string;
  schoolShortName: string;
  program?: string | null;
  yearLevel?: number | null;
  submittedAt: string;
  documentName: string;
};

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  hasAvatar?: boolean;
  status: string;
  roles: string[];
};
export type SessionResponse = {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
  user: AuthUser;
  trustedDeviceToken?: string;
  trustedForDays?: number;
};
export type AuthSession = {
  id: string;
  clientType: "WEB" | "MOBILE";
  deviceName: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};
export type MfaChallengeResponse = {
  requiresTwoFactor: true;
  challengeToken: string;
  method: "AUTHENTICATOR";
};
export type AuthResponse = SessionResponse | MfaChallengeResponse;
export type MfaStatus = {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  required: boolean;
  trustedDeviceCount: number;
};
export type MfaSetup = {
  secret: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
};
export type StudentProfile = {
  userId: string;
  schoolId: string;
  program: string | null;
  yearLevel: number | null;
  bio: string | null;
  verificationStatus: "UNVERIFIED" | "PENDING" | "APPROVED" | "REJECTED";
  school: School;
};
export type StudentVerificationRequest = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
};
export type RegistrationResponse = {
  requiresVerification: true;
  email: string;
  developmentCode?: string;
};
export type CodeResponse = { message: string; developmentCode?: string };

export type DashboardStats = {
  registeredStudents: number;
  activeServices: number;
  completedOrders: number;
  pendingVerifications: number;
};

export type ProviderStats = {
  activeOrders: number;
  pendingRequests: number;
  completedOrders: number;
  averageRating: number;
  reviewCount: number;
  profileStrength: number;
  verified?: boolean;
  maxActiveOrders: number;
  maxPendingOrders: number;
  acceptingOrders: boolean;
};

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  orderId?: string | null;
  readAt?: string | null;
  createdAt: string;
};
export type SupportTicketCategory =
  | "ACCOUNT"
  | "PAYMENT"
  | "ORDER"
  | "TECHNICAL"
  | "SAFETY"
  | "OTHER";
export type SupportTicketReceipt = {
  data: {
    id: string;
    category: SupportTicketCategory;
    status: string;
    subject: string;
    createdAt: string;
  };
  reference: string;
  message: string;
};
export type OrderFile = {
  id: string;
  purpose: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string | null;
  createdAt: string;
};
export type DeliverySubmission = {
  id: string;
  providerId: string;
  version: number;
  note: string | null;
  revisionRequestId?: string | null;
  submittedAt: string;
  createdAt: string;
  isCurrent: boolean;
  files: OrderFile[];
};
export type OrderRevision = {
  id: string;
  sequenceNumber: number;
  type: "PROVIDER_CORRECTION" | "INCLUDED" | "PAID_EXTRA" | null;
  instructions: string;
  status: string;
  sourceDeliverySubmissionId: string | null;
  revisionDeadlineAt: string | null;
  turnaroundMinutes: number | null;
  providerAcknowledgedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  purchase?: OrderRevisionPurchase | null;
};
export type OrderRevisionPurchase = {
  id: string;
  sourceDeliverySubmissionId: string;
  providerSubtotalCentavos: number;
  platformFeeCentavos: number;
  totalCentavos: number;
  currency: string;
  turnaroundMinutes: number;
  pricingPolicyVersion: number;
  paymentStatus: string;
  activationStatus: "PENDING" | "ACTIVATED" | "RECONCILIATION_REQUIRED";
  failureCode: string | null;
  paidAt: string | null;
  activatedAt: string | null;
  createdAt: string;
};
export type ExtraRevisionQuote = {
  revisionType: "PAID_EXTRA";
  providerSubtotalCentavos: number;
  platformFeeCentavos: number;
  clientTotalCentavos: number;
  currency: string;
  turnaroundMinutes: number;
  pricingPolicyVersion: number;
  pricingBasisCentavos: number;
  deliveryDurationBasisMinutes: number;
  sourceOrderId: string;
  currentDeliverySubmissionId: string;
};
export type OrderReview = {
  id: string;
  overallRating: number;
  qualityRating: number | null;
  communicationRating: number | null;
  timelinessRating: number | null;
  comment: string | null;
  createdAt: string;
};
export type MarketplaceOrder = {
  id: string;
  pricingModel?: OrderPricingModel;
  termsSnapshotVersion?: number;
  orderNumber: string;
  title: string;
  status: string;
  requirements: string;
  subtotalCentavos: number;
  platformFeeCentavos: number;
  totalCentavos: number;
  paymentStatus?: string | null;
  currency: string;
  dueAt: string | null;
  paymentConfirmedAt?: string | null;
  basePriceCentavos?: number | null;
  rushSurchargeCentavos?: number | null;
  deliveryOption?: DeliveryOption | null;
  deliveryDurationMinutes?: number | null;
  pricingPolicyVersion?: number | null;
  platformFeeBasisPoints?: number | null;
  rushBasisPoints?: number | null;
  createdAt: string;
  completedAt?: string | null;
  completionSource?: "CLIENT_ACCEPTED" | "AUTO_REVIEW_TIMEOUT" | null;
  reviewPolicyVersion?: number | null;
  reviewStartedAt?: string | null;
  reviewDeadlineAt?: string | null;
  reviewDeliverySubmissionId?: string | null;
  reviewState?:
    | "ACTIVE"
    | "BLOCKED_BY_DISPUTE"
    | "COMPLETED"
    | "SUPERSEDED"
    | null;
  reviewActionable?: boolean;
  revisionsUsed: number;
  revisionLimit: number;
  files: OrderFile[];
  deliverySubmissions?: DeliverySubmission[];
  currentDeliverySubmission?: DeliverySubmission | null;
  revisions: OrderRevision[];
  revisionPurchases?: OrderRevisionPurchase[];
  review: OrderReview | null;
  client: { id: string; displayName: string };
  provider: { id: string; displayName: string };
  package?: {
    id: string;
    tier: string;
    name: string;
    deliveryDays: number;
    revisionLimit: number;
  };
};
export type OrderHistoryItem = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
  actor: { id: string; displayName: string } | null;
};
export type MessageAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};
export type OrderMessage = {
  id: string;
  body: string | null;
  messageType: string;
  createdAt: string;
  isMine: boolean;
  attachments: MessageAttachment[];
  sender: {
    id: string;
    displayName: string;
    hasAvatar: boolean;
    avatarVersion: number;
  };
};
export type OrderWorkspace = MarketplaceOrder & { history: OrderHistoryItem[] };

export type DisputeReason =
  | "SERVICE_NOT_DELIVERED"
  | "QUALITY_ISSUE"
  | "REQUIREMENTS_MISMATCH"
  | "PAYMENT_ISSUE"
  | "CONDUCT"
  | "OTHER";
export type OrderDispute = {
  id: string;
  orderId: string;
  reason: DisputeReason;
  details: string;
  status:
    | "OPEN"
    | "WAITING_FOR_CLIENT"
    | "WAITING_FOR_PROVIDER"
    | "READY_FOR_REVIEW"
    | "UNDER_REVIEW"
    | "RESOLVED_CLIENT"
    | "RESOLVED_PROVIDER"
    | "CLOSED";
  resolutionNote: string | null;
  responseRequestedFrom: "CLIENT" | "PROVIDER" | null;
  responseRequestedAt: string | null;
  responseDeadlineAt: string | null;
  readyForReviewAt: string | null;
  reviewStartedAt: string | null;
  targetDeliverySubmission?: {
    id: string;
    version: number;
    submittedAt: string;
  } | null;
  targetRevisionRequest?: {
    id: string;
    sequenceNumber: number;
    type: "PROVIDER_CORRECTION" | "INCLUDED" | "PAID_EXTRA" | null;
    createdAt: string;
  } | null;
  affectedEarnings: {
    id: string;
    preFreezeStatus: "PENDING" | "AVAILABLE";
    frozenAt: string;
    restoredAt: string | null;
    providerEarning: {
      id: string;
      sourceType: "ORIGINAL_ORDER" | "PAID_EXTRA_REVISION";
      status: ProviderEarningStatus;
      currency: string;
      grossServiceAmountCentavos: number;
    };
  }[];
  evidence: {
    id: string;
    responseId: string | null;
    submittedById: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
    createdAt: string;
  }[];
  responses: {
    id: string;
    requestSequence: number;
    requestedFrom: "CLIENT" | "PROVIDER";
    details: string;
    responseRequestedAt: string;
    responseDeadlineAt: string;
    createdAt: string;
    responder: { id: string; displayName: string };
  }[];
  timeline: {
    id: string;
    type: string;
    details: string | null;
    createdAt: string;
    actor: { id: string; displayName: string } | null;
  }[];
  createdAt: string;
  updatedAt: string;
  openedBy: { id: string; displayName: string };
  resolvedBy?: { id: string; displayName: string } | null;
  order?: MarketplaceOrder;
};
export type OrderPayment = {
  id: string;
  provider: "PAYMONGO";
  amountCentavos: number;
  platformFeeCentavos: number;
  providerNetCentavos: number;
  refundedCentavos: number;
  currency: string;
  status:
    | "PENDING"
    | "REQUIRES_ACTION"
    | "PAID"
    | "FAILED"
    | "REFUND_PENDING"
    | "PARTIALLY_REFUNDED"
    | "REFUNDED"
    | "CANCELLED";
  paidAt: string | null;
  createdAt: string;
  refunds?: MarketplaceRefund[];
};

export type RefundStatus =
  | "REQUESTED"
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "RECONCILIATION_REQUIRED";
export type MarketplaceRefundReason =
  | "PAID_NOT_STARTED"
  | "MISSED_RUSH_DEADLINE"
  | "DISPUTE_CLIENT_WIN"
  | "STALE_REVISION_PAYMENT"
  | "ADMIN_EXCEPTION";
export type MarketplaceRefund = {
  id: string;
  orderId: string;
  paymentId: string | null;
  revisionPurchaseId: string | null;
  triggeringDisputeId: string | null;
  sourceType: "ORIGINAL_ORDER" | "PAID_EXTRA_REVISION";
  reasonCode: MarketplaceRefundReason;
  requestOrigin: "CLIENT" | "ADMIN" | "SYSTEM";
  providerRefundId: string | null;
  providerPrincipalCentavos: number;
  platformFeeCentavos: number;
  refundTotalCentavos: number;
  currency: string;
  status: RefundStatus;
  providerStatus: string | null;
  failureCode: string | null;
  requestedAt: string;
  submittedAt: string | null;
  processedAt: string | null;
  reconciliationRequiredAt: string | null;
  accountingReversedAt: string | null;
  providerPrincipalReversedCentavos: number;
  platformFeeReversedCentavos: number;
  createdAt: string;
  updatedAt: string;
  order?: { orderNumber: string; titleSnapshot: string };
};
export type RefundEligibility = {
  canRequest: boolean;
  eligibleReasons: Extract<
    MarketplaceRefundReason,
    "PAID_NOT_STARTED" | "MISSED_RUSH_DEADLINE"
  >[];
  sourceType: "ORIGINAL_ORDER" | null;
  payment: {
    id: string;
    providerPrincipalCentavos: number;
    platformFeeCentavos: number;
    refundTotalCentavos: number;
    currency: string;
    status: string;
  } | null;
  refund: Pick<MarketplaceRefund, "id" | "status" | "reasonCode"> | null;
};
export type StaleRevisionRefundCandidate = {
  id: string;
  orderId: string;
  providerSubtotalCentavos: number;
  platformFeeCentavos: number;
  totalCentavos: number;
  currency: string;
  paidAt: string | null;
  failureCode: string | null;
  order: { orderNumber: string; titleSnapshot: string };
};

export type ProviderEarningStatus =
  | "PENDING"
  | "AVAILABLE"
  | "FROZEN"
  | "PAYOUT_PROCESSING"
  | "PAID_OUT"
  | "REFUNDED";
export type ProviderEarningsSummary = {
  currency: string;
  pendingCentavos: number;
  availableCentavos: number;
  withdrawableCentavos: number;
  frozenCentavos: number;
  payoutProcessingCentavos: number;
  paidOutCentavos: number;
  refundedCentavos: number;
};
export type ProviderEarning = {
  id: string;
  orderId: string;
  orderNumber: string;
  serviceTitle: string;
  sourceType?: "ORIGINAL_ORDER" | "PAID_EXTRA_REVISION";
  revisionSequence?: number | null;
  amountCentavos: number;
  currency: string;
  status: ProviderEarningStatus;
  pendingAt: string;
  availableAt: string | null;
  withdrawalEligibleAt: string | null;
  isWithdrawable: boolean;
  createdAt: string;
  entries: {
    type:
      | "EARNING_PENDING_CREDIT"
      | "EARNING_AVAILABLE_RELEASE"
      | "EARNING_FROZEN"
      | "EARNING_UNFROZEN"
      | "EARNING_REFUND_REVERSAL"
      | "EARNING_PAYOUT_RESERVED"
      | "EARNING_PAYOUT_RELEASED"
      | "EARNING_PAID_OUT";
    amountCentavos: number;
    currency: string;
    createdAt: string;
  }[];
};

export type PayoutDestination = {
  id: string;
  type: "BANK_ACCOUNT" | "E_WALLET";
  displayLabel: string;
  maskedAccountIdentifier: string;
  accountHolderName: string;
  verificationStatus: "UNVERIFIED" | "ADMIN_REVIEWED" | "PROVIDER_VERIFIED";
  reviewedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SensitivePayoutDestination = Pick<
  PayoutDestination,
  "id" | "type" | "displayLabel" | "accountHolderName"
> & {
  accountIdentifier: string;
};

export type ProviderPayoutStatus =
  | "REQUESTED"
  | "APPROVED"
  | "PROCESSING"
  | "PAID"
  | "FAILED"
  | "REJECTED"
  | "CANCELLED"
  | "RECONCILIATION_REQUIRED";

export type ProviderPayout = {
  id: string;
  providerId: string;
  destinationId: string;
  currency: string;
  requestedPrincipalCentavos: number;
  payoutFeeCentavos: number;
  netDisbursementCentavos: number;
  status: ProviderPayoutStatus;
  destinationSnapshot: {
    type: PayoutDestination["type"];
    displayLabel: string;
    maskedAccountIdentifier: string;
    accountHolderName: string;
    verificationStatus: PayoutDestination["verificationStatus"];
  };
  settlementMethod: "MANUAL" | "EXTERNAL_PROVIDER" | null;
  externalStatus: string | null;
  failureCode: string | null;
  requestedAt: string;
  approvedAt: string | null;
  processingAt: string | null;
  paidAt: string | null;
  failedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  reconciliationRequiredAt: string | null;
  items: {
    id: string;
    providerEarningId: string;
    principalCentavos: number;
    currency: string;
    reservationActive: boolean;
  }[];
};

export type AdminProviderPayout = ProviderPayout & {
  manualSettlementReference: string | null;
  settlementNote: string | null;
  settlementAt: string | null;
  provider: { id: string; displayName: string; email: string };
  destination: PayoutDestination;
  audits: {
    id: string;
    action: string;
    context: unknown;
    createdAt: string;
    actor: { id: string; displayName: string } | null;
  }[];
};

export type ProviderProfile = {
  userId: string;
  headline: string;
  bio: string;
  skills: string[];
  isAvailable: boolean;
  maxActiveOrders: number;
  maxPendingOrders: number;
  instagramUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  portfolioUrl: string | null;
};
export type ProviderPackage = {
  id: string;
  tier: "BASIC" | "STANDARD" | "PREMIUM";
  name: string;
  description: string;
  priceCentavos: number;
  deliveryDays: number;
  revisionLimit: number;
  isActive: boolean;
};
export type ServiceMedia = {
  id: string;
  kind: "COVER" | "PORTFOLIO";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
};
export type ProviderServiceStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "PUBLISHED"
  | "PAUSED"
  | "REJECTED"
  | "ARCHIVED";
export type ProviderService = {
  id: string;
  pricingModel?: ServicePricingModel;
  basePriceCentavos?: number | null;
  normalDeliveryMinutes?: number | null;
  includedRevisionLimit?: number | null;
  acceptsRushOrders?: boolean;
  fastestRushTier?: RushTier | null;
  title: string;
  description: string;
  status: ProviderServiceStatus;
  deliveryMethod: string;
  campusLocation?: string | null;
  rejectionReason?: string | null;
  category: Category;
  packages: ProviderPackage[];
  media: ServiceMedia[];
  updatedAt: string;
};
export type ModerationService = ProviderService & {
  provider: {
    displayName: string;
    email: string;
    studentProfile?: {
      school?: { name: string; shortName: string } | null;
    } | null;
  };
};
export type SchoolAdministrator = {
  userId: string;
  createdAt: string;
  user: { id: string; displayName: string; email: string; status: string };
  school: { id: string; name: string; shortName: string };
};
