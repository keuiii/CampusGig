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
  provider: string;
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
export type MarketplaceOrder = { id: string; orderNumber: string; title: string; status: string; requirements: string; totalCentavos: number; currency: string; dueAt: string; createdAt: string; client: { id: string; displayName: string }; provider: { id: string; displayName: string }; package: { id: string; tier: string; name: string; deliveryDays: number; revisionLimit: number } };

export type ProviderProfile = { userId: string; headline: string; bio: string; skills: string[]; isAvailable: boolean };
export type ProviderPackage = { id: string; tier: "BASIC" | "STANDARD" | "PREMIUM"; name: string; description: string; priceCentavos: number; deliveryDays: number; revisionLimit: number; isActive: boolean };
export type ServiceMedia = { id: string; kind: "COVER" | "PORTFOLIO"; originalName: string; mimeType: string; sizeBytes: number; sortOrder: number };
export type ProviderService = { id: string; title: string; description: string; status: string; deliveryMethod: string; campusLocation?: string | null; rejectionReason?: string | null; category: Category; packages: ProviderPackage[]; media: ServiceMedia[]; updatedAt: string };
export type ModerationService = ProviderService & { provider: { displayName: string; email: string; studentProfile?: { school?: { name: string; shortName: string } | null } | null } };
export type SchoolAdministrator = { userId: string; createdAt: string; user: { id: string; displayName: string; email: string; status: string }; school: { id: string; name: string; shortName: string } };
