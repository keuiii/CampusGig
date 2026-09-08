export type Tab = "home" | "orders" | "messages" | "profile";

export type Category = {
  id: string;
  name: string;
  icon: string;
  tint: string;
  ink: string;
  serviceCount: number;
};

export type School = {
  id: string;
  name: string;
  shortName: string;
  city: string;
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

export type Service = {
  id: string;
  title: string;
  description: string;
  category: string;
  providerId: string;
  provider: string;
  providerHasAvatar: boolean;
  providerAvatarVersion: number;
  schoolId: string;
  school: string;
  price: number;
  rating: number;
  delivery: string;
  packages: ServicePackage[];
  coverMediaId?: string | null;
  portfolio?: { id: string; originalName: string; mimeType: string }[];
};

export type MobileOrder = {
  id: string;
  orderNumber: string;
  title: string;
  status: string;
  requirements: string;
  totalCentavos: number;
  subtotalCentavos: number;
  platformFeeCentavos: number;
  paymentStatus?: string | null;
  currency: string;
  dueAt: string;
  createdAt: string;
  provider: { id: string; displayName: string };
  package: ServicePackage;
};

export type OrderHistoryItem = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
  actor: { id: string; displayName: string };
};

export type OrderFile = {
  id: string;
  purpose: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type OrderRevision = {
  id: string;
  sequenceNumber: number;
  instructions: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
};

export type OrderReview = {
  id: string;
  overallRating: number;
  comment: string | null;
  createdAt: string;
};

export type MobileOrderDetail = MobileOrder & {
  revisionsUsed: number;
  revisionLimit: number;
  files: OrderFile[];
  revisions: OrderRevision[];
  review: OrderReview | null;
  history: OrderHistoryItem[];
};

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
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED_CLIENT" | "RESOLVED_PROVIDER" | "CLOSED";
  resolutionNote: string | null;
  createdAt: string;
};
export type OrderPayment = {
  id: string;
  amountCentavos: number;
  currency: string;
  status: "PENDING" | "REQUIRES_ACTION" | "PAID" | "FAILED" | "REFUND_PENDING" | "PARTIALLY_REFUNDED" | "REFUNDED" | "CANCELLED";
  paidAt: string | null;
  createdAt: string;
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

export type MobileNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  orderId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type ConversationInboxItem = {
  id: string;
  unreadCount: number;
  updatedAt: string;
  participant: {
    id: string;
    displayName: string;
    hasAvatar: boolean;
    avatarVersion: number;
  };
  latestMessage: OrderMessage | null;
  order: MobileOrder;
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
  user: AuthUser;
  trustedDeviceToken?: string;
  trustedForDays?: number;
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

export type RegistrationResponse = {
  requiresVerification: true;
  email: string;
  developmentCode?: string;
};

export type StudentProfile = {
  schoolId: string;
  program: string | null;
  yearLevel: number | null;
  bio: string | null;
  verificationStatus: string;
  school: School;
};

export type VerificationRequest = {
  id: string;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
};

export type ProviderProfileData = {
  userId: string;
  headline: string;
  bio: string;
  skills: string[];
  isAvailable: boolean;
};
