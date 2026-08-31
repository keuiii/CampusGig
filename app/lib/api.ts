import type {
  AppNotification,
  AuthResponse,
  AuthUser,
  Category,
  CodeResponse,
  DashboardStats,
  MarketplaceOrder,
  ModerationService,
  OrderMessage,
  OrderWorkspace,
  ProviderProfile,
  ProviderService,
  ProviderStats,
  RegistrationResponse,
  School,
  SchoolAdministrator,
  Service,
  StudentProfile,
  StudentVerificationRequest,
  Verification,
} from "../types";
import {
  ApiError,
  apiUrl,
  backendConfigured,
  request,
  uploadForm,
} from "./http-client";

type Collection<T> = T[] | { data: T[] };
const items = <T>(payload: Collection<T>) =>
  Array.isArray(payload) ? payload : payload.data;

export const api = {
  avatarUrl: (userId: string, version?: number) =>
    `${apiUrl()}/api/v1/profile/avatar/${userId}${version ? `?v=${version}` : ""}`,
  uploadAvatar: async (token: string, file: File) => {
    const form = new FormData();
    form.append("avatar", file);
    return uploadForm<{ data: { hasAvatar: true } }>(
      "/profile/avatar",
      form,
      token,
      "Profile picture upload failed",
    );
  },
  serviceMediaUrl: (serviceId: string, mediaId: string) =>
    `${apiUrl()}/api/v1/services/${serviceId}/media/${mediaId}`,
  services: async (schoolId?: string) =>
    items(
      await request<Collection<Service>>(
        `/services${schoolId ? `?schoolId=${encodeURIComponent(schoolId)}` : ""}`,
      ),
    ),
  schools: async () => items(await request<Collection<School>>("/schools")),
  categories: async () =>
    items(await request<Collection<Category>>("/categories")),
  clientOrders: async (token: string) =>
    items(
      await request<Collection<MarketplaceOrder>>("/orders", undefined, token),
    ),
  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  socialLogin: (provider: "GOOGLE", idToken: string) =>
    request<AuthResponse>("/auth/social", {
      method: "POST",
      body: JSON.stringify({ provider, idToken }),
    }),
  register: (
    displayName: string,
    email: string,
    password: string,
    isStudent: boolean,
  ) =>
    request<RegistrationResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ displayName, email, password, isStudent }),
    }),
  verifyEmail: (email: string, code: string) =>
    request<AuthResponse>("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),
  resendVerification: (email: string) =>
    request<CodeResponse>("/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  forgotPassword: (email: string) =>
    request<CodeResponse>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (email: string, code: string, password: string) =>
    request<CodeResponse>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, code, password }),
    }),
  me: (token: string) => request<AuthUser>("/auth/me", undefined, token),
  studentProfile: (token: string) =>
    request<{ data: StudentProfile | null }>(
      "/profile/student",
      undefined,
      token,
    ),
  studentVerification: (token: string) =>
    request<{ data: StudentVerificationRequest | null }>(
      "/profile/student/verification",
      undefined,
      token,
    ),
  verifications: async (token: string) =>
    items(
      await request<Collection<Verification>>(
        "/admin/verifications",
        undefined,
        token,
      ),
    ),
  adminSchools: async (token: string) =>
    items(
      await request<Collection<School>>("/admin/schools", undefined, token),
    ),
  createSchool: (
    token: string,
    input: {
      name: string;
      shortName: string;
      emailDomain?: string;
      address?: string;
    },
  ) =>
    request<School>(
      "/admin/schools",
      { method: "POST", body: JSON.stringify(input) },
      token,
    ),
  updateSchoolStatus: (
    token: string,
    id: string,
    status: "PENDING" | "ACTIVE" | "DISABLED",
  ) =>
    request<School>(
      `/admin/schools/${id}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
      token,
    ),
  adminStats: (token: string) =>
    request<DashboardStats>("/admin/dashboard", undefined, token),
  schoolAdministrators: async (token: string) =>
    items(
      await request<Collection<SchoolAdministrator>>(
        "/admin/school-admins",
        undefined,
        token,
      ),
    ),
  assignSchoolAdministrator: (token: string, email: string, schoolId: string) =>
    request<SchoolAdministrator>(
      "/admin/school-admins",
      { method: "POST", body: JSON.stringify({ email, schoolId }) },
      token,
    ),
  removeSchoolAdministrator: (token: string, userId: string) =>
    request<{ message: string }>(
      `/admin/school-admins/${userId}`,
      { method: "DELETE" },
      token,
    ),
  moderationServices: async (token: string) =>
    items(
      await request<Collection<ModerationService>>(
        "/admin/services",
        undefined,
        token,
      ),
    ),
  approveService: (token: string, id: string) =>
    request<{ data: ModerationService }>(
      `/admin/services/${id}/approve`,
      { method: "POST" },
      token,
    ),
  rejectService: (token: string, id: string, reason: string) =>
    request<{ data: ModerationService }>(
      `/admin/services/${id}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
      token,
    ),
  providerStats: (token: string) =>
    request<ProviderStats>("/provider/dashboard", undefined, token),
  notifications: (token: string) =>
    request<{ data: AppNotification[]; unreadCount: number }>(
      "/notifications",
      undefined,
      token,
    ),
  markNotificationRead: (token: string, id: string) =>
    request<{ data: AppNotification }>(
      `/notifications/${id}/read`,
      { method: "PATCH" },
      token,
    ),
  providerOrders: async (token: string) =>
    items(
      await request<Collection<MarketplaceOrder>>(
        "/orders?scope=provider",
        undefined,
        token,
      ),
    ),
  order: (token: string, id: string) =>
    request<{ data: OrderWorkspace }>(`/orders/${id}`, undefined, token),
  messages: (token: string, orderId: string) =>
    request<{ data: OrderMessage[] }>(
      `/orders/${orderId}/messages`,
      undefined,
      token,
    ),
  sendMessage: (token: string, orderId: string, body: string) =>
    request<{ data: OrderMessage }>(
      `/orders/${orderId}/messages`,
      { method: "POST", body: JSON.stringify({ body }) },
      token,
    ),
  sendMessageAttachments: async (
    token: string,
    orderId: string,
    files: File[],
    body?: string,
  ) => {
    const form = new FormData();
    if (body?.trim()) form.append("body", body.trim());
    files.forEach((file) => form.append("files", file));
    const response = await fetch(
      `${apiUrl()}/api/v1/orders/${orderId}/messages/attachments`,
      {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        response.status,
        Array.isArray(payload?.message)
          ? payload.message.join(" ")
          : (payload?.message ?? "Attachment upload failed"),
      );
    return payload as { data: OrderMessage };
  },
  acceptOrder: (token: string, id: string) =>
    request<{ data: MarketplaceOrder; message: string }>(
      `/orders/${id}/accept`,
      { method: "POST" },
      token,
    ),
  rejectOrder: (token: string, id: string, reason: string) =>
    request<{ data: MarketplaceOrder; message: string }>(
      `/orders/${id}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
      token,
    ),
  startOrder: (token: string, id: string) =>
    request<{ data: MarketplaceOrder; message: string }>(
      `/orders/${id}/start`,
      { method: "POST" },
      token,
    ),
  deliverOrder: async (
    token: string,
    id: string,
    note: string,
    files: File[],
  ) => {
    const form = new FormData();
    form.append("note", note);
    files.forEach((file) => form.append("files", file));
    const response = await fetch(`${apiUrl()}/api/v1/orders/${id}/deliver`, {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        response.status,
        Array.isArray(body?.message)
          ? body.message.join(" ")
          : (body?.message ?? "Delivery upload failed"),
      );
    return body as { data: MarketplaceOrder; message: string };
  },
  orderFile: async (token: string, orderId: string, fileId: string) => {
    const response = await fetch(
      `${apiUrl()}/api/v1/orders/${orderId}/files/${fileId}`,
      { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok)
      throw new ApiError(response.status, "Unable to download file");
    return response.blob();
  },
  requestOrderRevision: (token: string, id: string, instructions: string) =>
    request<{ data: MarketplaceOrder; message: string }>(
      `/orders/${id}/revision`,
      { method: "POST", body: JSON.stringify({ instructions }) },
      token,
    ),
  completeOrder: (token: string, id: string) =>
    request<{ data: MarketplaceOrder; message: string }>(
      `/orders/${id}/complete`,
      { method: "POST" },
      token,
    ),
  reviewOrder: (
    token: string,
    id: string,
    input: {
      overallRating: number;
      qualityRating?: number;
      communicationRating?: number;
      timelinessRating?: number;
      comment?: string;
    },
  ) =>
    request<{ data: MarketplaceOrder; message: string }>(
      `/orders/${id}/review`,
      { method: "POST", body: JSON.stringify(input) },
      token,
    ),
  providerProfile: (token: string) =>
    request<{ data: ProviderProfile | null }>(
      "/provider/profile",
      undefined,
      token,
    ),
  updateProviderProfile: (
    token: string,
    input: {
      headline: string;
      bio: string;
      skills: string[];
      isAvailable: boolean;
    },
  ) =>
    request<{ data: ProviderProfile }>(
      "/provider/profile",
      { method: "PUT", body: JSON.stringify(input) },
      token,
    ),
  providerServices: async (token: string) =>
    items(
      await request<Collection<ProviderService>>(
        "/provider/services",
        undefined,
        token,
      ),
    ),
  createProviderService: (token: string, input: unknown) =>
    request<{ data: ProviderService }>(
      "/provider/services",
      { method: "POST", body: JSON.stringify(input) },
      token,
    ),
  updateProviderService: (token: string, id: string, input: unknown) =>
    request<{ data: ProviderService }>(
      `/provider/services/${id}`,
      { method: "PUT", body: JSON.stringify(input) },
      token,
    ),
  uploadProviderMedia: async (
    token: string,
    id: string,
    cover?: File | null,
    portfolio?: File[],
  ) => {
    const form = new FormData();
    if (cover) form.append("cover", cover);
    portfolio?.forEach((file) => form.append("portfolio", file));
    const response = await fetch(
      `${apiUrl()}/api/v1/provider/services/${id}/media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        response.status,
        Array.isArray(body?.message)
          ? body.message.join(" ")
          : (body?.message ?? "Media upload failed"),
      );
    return body as { data: import("../types").ServiceMedia[] };
  },
  removeProviderMedia: (token: string, serviceId: string, mediaId: string) =>
    request<{ message: string }>(
      `/provider/services/${serviceId}/media/${mediaId}`,
      { method: "DELETE" },
      token,
    ),
  submitProviderService: (token: string, id: string) =>
    request<{ data: ProviderService }>(
      `/provider/services/${id}/submit`,
      { method: "POST" },
      token,
    ),
  approveVerification: (token: string, id: string) =>
    request<void>(
      `/admin/verifications/${id}/approve`,
      { method: "POST" },
      token,
    ),
  rejectVerification: (token: string, id: string, reason: string) =>
    request<void>(
      `/admin/verifications/${id}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
      token,
    ),
  verificationDocument: async (token: string, id: string) => {
    const response = await fetch(
      `${apiUrl()}/api/v1/admin/verifications/${id}/document`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok)
      throw new ApiError(
        response.status,
        "Unable to open the private document",
      );
    return response.blob();
  },
};

export { backendConfigured };
