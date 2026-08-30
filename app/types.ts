export type Category = {
  id: string;
  name: string;
  serviceCount: number;
  icon?: string;
  color?: string;
};

export type Service = {
  id: string;
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
  delivery: string;
  color?: string;
  icon?: string;
  description: string;
  coverMediaId?: string | null;
  portfolio?: { id: string; originalName: string; mimeType: string }[];
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

export type AuthUser = { id: string; email: string; displayName: string; hasAvatar?: boolean; status: string; roles: string[] };
export type AuthResponse = { accessToken: string; user: AuthUser };
export type RegistrationResponse = { requiresVerification: true; email: string; developmentCode?: string };
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
};

export type AppNotification = { id: string; type: string; title: string; body: string; orderId?: string | null; readAt?: string | null; createdAt: string };
export type OrderFile = { id: string; purpose: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string };
export type OrderRevision = { id: string; sequenceNumber: number; instructions: string; status: string; createdAt: string; resolvedAt: string | null };
export type OrderReview = { id: string; overallRating: number; qualityRating: number | null; communicationRating: number | null; timelinessRating: number | null; comment: string | null; createdAt: string };
export type MarketplaceOrder = { id: string; orderNumber: string; title: string; status: string; requirements: string; totalCentavos: number; currency: string; dueAt: string; createdAt: string; revisionsUsed: number; revisionLimit: number; files: OrderFile[]; revisions: OrderRevision[]; review: OrderReview | null; client: { id: string; displayName: string }; provider: { id: string; displayName: string }; package: { id: string; tier: string; name: string; deliveryDays: number; revisionLimit: number } };
export type OrderHistoryItem = { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string; actor: { id: string; displayName: string } };
export type MessageAttachment = { id: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string };
export type OrderMessage = { id: string; body: string | null; messageType: string; createdAt: string; isMine: boolean; attachments: MessageAttachment[]; sender: { id: string; displayName: string; hasAvatar: boolean; avatarVersion: number } };
export type OrderWorkspace = MarketplaceOrder & { history: OrderHistoryItem[] };

export type ProviderProfile = { userId: string; headline: string; bio: string; skills: string[]; isAvailable: boolean };
export type ProviderPackage = { id: string; tier: "BASIC" | "STANDARD" | "PREMIUM"; name: string; description: string; priceCentavos: number; deliveryDays: number; revisionLimit: number; isActive: boolean };
export type ServiceMedia = { id: string; kind: "COVER" | "PORTFOLIO"; originalName: string; mimeType: string; sizeBytes: number; sortOrder: number };
export type ProviderService = { id: string; title: string; description: string; status: string; deliveryMethod: string; campusLocation?: string | null; rejectionReason?: string | null; category: Category; packages: ProviderPackage[]; media: ServiceMedia[]; updatedAt: string };
export type ModerationService = ProviderService & { provider: { displayName: string; email: string; studentProfile?: { school?: { name: string; shortName: string } | null } | null } };
export type SchoolAdministrator = { userId: string; createdAt: string; user: { id: string; displayName: string; email: string; status: string }; school: { id: string; name: string; shortName: string } };
