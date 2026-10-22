import type {
  AppNotification,
  AuthResponse,
  AuthUser,
  Category,
  CodeResponse,
  DashboardStats,
  MarketplaceOrder,
  MarketplaceQuote,
  DeliveryOption,
  MfaSetup,
  MfaStatus,
  ModerationService,
  OrderDispute,
  OrderPayment,
  MarketplaceRefund,
  MarketplaceRefundReason,
  RefundEligibility,
  OrderRevision,
  OrderRevisionPurchase,
  DisputeReason,
  ExtraRevisionQuote,
  OrderMessage,
  OrderWorkspace,
  ProviderProfile,
  ProviderEarning,
  ProviderEarningsSummary,
  PayoutDestination,
  SensitivePayoutDestination,
  ProviderPayout,
  AdminProviderPayout,
  PublicProviderProfile,
  PublicProviderReviews,
  ProviderService,
  ProviderStats,
  SupportTicketCategory,
  SupportTicketReceipt,
  RegistrationResponse,
  SessionResponse,
  School,
  SchoolAdministrator,
  ServicePage,
  StudentProfile,
  StudentVerificationRequest,
  Verification,
} from "../types";
import {
  ApiError,
  authenticatedFetch,
  apiUrl,
  backendConfigured,
  request,
  signalUnauthorized,
  uploadForm,
} from "./http-client";

const webDeviceName = () =>
  typeof navigator === "undefined"
    ? "Web browser"
    : `${navigator.platform || "Web"} browser`.slice(0, 100);

type Collection<T> = T[] | { data: T[] };
export type CursorPage<T> = {
  data: T[];
  pagination: { hasMore: boolean; nextCursor: string | null };
};
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
  services: (
    filters: Record<string, string | number>,
    page = 1,
    savedToken?: string,
    signal?: AbortSignal,
  ) => {
    const parameters = new URLSearchParams({ page: String(page) });
    for (const [key, value] of Object.entries(filters))
      if (value !== "" && value !== 0 && value !== "any" && value !== "All")
        parameters.set(key, String(value));
    return request<ServicePage>(
      `/services${savedToken ? "/saved" : ""}?${parameters}`,
      { signal },
      savedToken,
    );
  },
  savedServiceIds: (token: string) =>
    request<{ data: string[] }>("/services/saved/ids", undefined, token),
  saveService: (token: string, id: string) =>
    request<{ saved: boolean }>(
      `/services/${encodeURIComponent(id)}/save`,
      { method: "PUT" },
      token,
    ),
  unsaveService: (token: string, id: string) =>
    request<{ saved: boolean }>(
      `/services/${encodeURIComponent(id)}/save`,
      { method: "DELETE" },
      token,
    ),
  publicProvider: (providerId: string) =>
    request<{ data: PublicProviderProfile }>(
      `/providers/${encodeURIComponent(providerId)}/public`,
    ),
  publicProviderReviews: (providerId: string, page = 1, pageSize = 5) =>
    request<PublicProviderReviews>(
      `/providers/${encodeURIComponent(providerId)}/reviews?page=${page}&pageSize=${pageSize}`,
    ),
  schools: async () => items(await request<Collection<School>>("/schools")),
  categories: async () =>
    items(await request<Collection<Category>>("/categories")),
  clientOrders: (token: string, cursor?: string) =>
    request<CursorPage<MarketplaceOrder>>(
      `/orders?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      undefined,
      token,
    ),
  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        clientType: "WEB",
        deviceName: webDeviceName(),
      }),
    }),
  socialLogin: (provider: "GOOGLE", idToken: string) =>
    request<AuthResponse>("/auth/social", {
      method: "POST",
      body: JSON.stringify({
        provider,
        idToken,
        clientType: "WEB",
        deviceName: webDeviceName(),
      }),
    }),
  verifyMfaChallenge: (
    challengeToken: string,
    code: string,
    recoveryCode = false,
    rememberDevice = false,
  ) =>
    request<import("../types").SessionResponse>("/auth/mfa/challenge", {
      method: "POST",
      body: JSON.stringify({
        challengeToken,
        code,
        recoveryCode,
        rememberDevice,
        clientType: "WEB",
        deviceName: webDeviceName(),
      }),
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
    request<SessionResponse>("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({
        email,
        code,
        clientType: "WEB",
        deviceName: webDeviceName(),
      }),
    }),
  refreshSession: () =>
    request<SessionResponse>("/auth/refresh", {
      method: "POST",
      body: "{}",
    }),
  logout: () =>
    request<{ revoked: number }>("/auth/logout", {
      method: "POST",
      body: "{}",
    }),
  authSessions: (token: string) =>
    request<{ data: import("../types").AuthSession[] }>(
      "/auth/sessions",
      undefined,
      token,
    ),
  revokeAuthSession: (token: string, id: string) =>
    request<{ revoked: number }>(
      `/auth/sessions/${id}`,
      { method: "DELETE" },
      token,
    ),
  logoutAll: (token: string) =>
    request<{ revoked: number }>("/auth/logout-all", { method: "POST" }, token),
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
  resetPassword: (
    email: string,
    code: string,
    password: string,
    mfaCode?: string,
    recoveryCode = false,
  ) =>
    request<CodeResponse>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, code, password, mfaCode, recoveryCode }),
    }),
  me: (token: string) => request<AuthUser>("/auth/me", undefined, token),
  mfaStatus: (token: string) =>
    request<MfaStatus>("/auth/mfa/status", undefined, token),
  beginMfaSetup: (token: string) =>
    request<MfaSetup>("/auth/mfa/setup", { method: "POST" }, token),
  confirmMfaSetup: (token: string, code: string) =>
    request<{ enabled: true; recoveryCodes: string[] }>(
      "/auth/mfa/setup/confirm",
      { method: "POST", body: JSON.stringify({ code }) },
      token,
    ),
  disableMfa: (token: string, currentPassword: string, code: string) =>
    request<{ enabled: false }>(
      "/auth/mfa/disable",
      { method: "POST", body: JSON.stringify({ currentPassword, code }) },
      token,
    ),
  regenerateRecoveryCodes: (token: string, code: string) =>
    request<{ recoveryCodes: string[] }>(
      "/auth/mfa/recovery-codes",
      { method: "POST", body: JSON.stringify({ code }) },
      token,
    ),
  revokeTrustedDevices: (token: string) =>
    request<{ revoked: number }>(
      "/auth/mfa/trusted-devices/revoke",
      { method: "POST" },
      token,
    ),
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
  verifications: (token: string, cursor?: string) =>
    request<CursorPage<Verification>>(
      `/admin/verifications?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      undefined,
      token,
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
  schoolAdministrators: (token: string, cursor?: string) =>
    request<CursorPage<SchoolAdministrator>>(
      `/admin/school-admins?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      undefined,
      token,
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
  moderationServices: (token: string, cursor?: string) =>
    request<CursorPage<ModerationService>>(
      `/admin/services?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      undefined,
      token,
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
  providerEarningsSummary: (token: string) =>
    request<{ data: ProviderEarningsSummary[] }>(
      "/provider/earnings/summary",
      undefined,
      token,
    ),
  providerEarnings: (token: string, cursor?: string) =>
    request<CursorPage<ProviderEarning>>(
      `/provider/earnings?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      undefined,
      token,
    ),
  providerPayoutDestinations: (token: string) =>
    request<{ data: PayoutDestination[] }>(
      "/provider/payouts/destinations",
      undefined,
      token,
    ),
  createProviderPayoutDestination: (
    token: string,
    input: {
      type: PayoutDestination["type"];
      displayLabel: string;
      accountIdentifier: string;
      accountHolderName: string;
    },
  ) =>
    request<{ data: PayoutDestination }>(
      "/provider/payouts/destinations",
      { method: "POST", body: JSON.stringify(input) },
      token,
    ),
  deactivateProviderPayoutDestination: (token: string, id: string) =>
    request<{ data: PayoutDestination }>(
      `/provider/payouts/destinations/${id}/deactivate`,
      { method: "POST", body: JSON.stringify({ confirmation: "CONFIRM" }) },
      token,
    ),
  providerPayouts: (token: string) =>
    request<{ data: ProviderPayout[] }>("/provider/payouts", undefined, token),
  requestProviderPayout: (
    token: string,
    input: { destinationId: string; currency: string; clientRequestId: string },
  ) =>
    request<{ data: ProviderPayout }>(
      "/provider/payouts",
      { method: "POST", body: JSON.stringify(input) },
      token,
    ),
  cancelProviderPayout: (token: string, id: string) =>
    request<{ data: ProviderPayout }>(
      `/provider/payouts/${id}/cancel`,
      { method: "POST", body: JSON.stringify({ confirmation: "CONFIRM" }) },
      token,
    ),
  adminPayouts: (token: string) =>
    request<{ data: AdminProviderPayout[] }>(
      "/admin/payouts",
      undefined,
      token,
    ),
  adminPayoutDestinations: (token: string) =>
    request<{
      data: (PayoutDestination & {
        provider: { id: string; displayName: string; email: string };
      })[];
    }>("/admin/payouts/destinations", undefined, token),
  sensitivePayoutDestination: (token: string, id: string) =>
    request<{ data: SensitivePayoutDestination }>(
      `/admin/payouts/destinations/${id}/sensitive-details`,
      undefined,
      token,
    ),
  reviewPayoutDestination: (token: string, id: string, note: string) =>
    request<{ data: PayoutDestination }>(
      `/admin/payouts/destinations/${id}/review`,
      { method: "POST", body: JSON.stringify({ note }) },
      token,
    ),
  decidePayout: (
    token: string,
    id: string,
    decision: "approve" | "reject",
    note: string,
  ) =>
    request<{ data: AdminProviderPayout }>(
      `/admin/payouts/${id}/${decision}`,
      { method: "POST", body: JSON.stringify({ note }) },
      token,
    ),
  beginManualPayout: (token: string, id: string, note: string) =>
    request<{ data: AdminProviderPayout }>(
      `/admin/payouts/${id}/manual-processing`,
      {
        method: "POST",
        body: JSON.stringify({ note, confirmation: "MANUAL SETTLEMENT" }),
      },
      token,
    ),
  settleManualPayout: (
    token: string,
    id: string,
    input: {
      amountCentavos: number;
      manualReference: string;
      settledAt: string;
      note: string;
    },
  ) =>
    request<{ data: AdminProviderPayout }>(
      `/admin/payouts/${id}/manual-settle`,
      {
        method: "POST",
        body: JSON.stringify({
          ...input,
          confirmation: "MANUAL SETTLEMENT CONFIRMED",
        }),
      },
      token,
    ),
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
  createOrder: (
    token: string,
    input: {
      clientRequestId: string;
      serviceId: string;
      servicePackageId?: string;
      deliveryOption?: DeliveryOption;
      requirements: string;
      requestedDeliveryDate?: string;
    },
  ) =>
    request<{ data: MarketplaceOrder; message: string }>(
      "/orders",
      { method: "POST", body: JSON.stringify(input) },
      token,
    ),
  quoteService: (
    token: string,
    serviceId: string,
    deliveryOption: DeliveryOption,
  ) =>
    request<{ data: MarketplaceQuote }>(
      `/services/${serviceId}/quote`,
      { method: "POST", body: JSON.stringify({ deliveryOption }) },
      token,
    ),
  markAllNotificationsRead: (token: string) =>
    request<{ updated: number; message: string }>(
      "/notifications/read-all",
      { method: "PATCH" },
      token,
    ),
  createSupportTicket: (
    token: string,
    input: {
      category: SupportTicketCategory;
      subject: string;
      message: string;
      source: "WEB";
    },
  ) =>
    request<SupportTicketReceipt>(
      "/support/tickets",
      { method: "POST", body: JSON.stringify(input) },
      token,
    ),
  providerOrders: (token: string, cursor?: string) =>
    request<CursorPage<MarketplaceOrder>>(
      `/orders?scope=provider&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      undefined,
      token,
    ),
  order: (token: string, id: string) =>
    request<{ data: OrderWorkspace }>(`/orders/${id}`, undefined, token),
  orderDispute: (token: string, id: string) =>
    request<{ data: OrderDispute | null }>(
      `/orders/${id}/disputes`,
      undefined,
      token,
    ),
  openOrderDispute: (
    token: string,
    id: string,
    reason: DisputeReason,
    details: string,
    files: File[] = [],
  ) => {
    const form = new FormData();
    form.append("reason", reason);
    form.append("details", details);
    files.forEach((file) => form.append("files", file));
    return uploadForm<{ data: OrderDispute; message: string }>(
      `/orders/${id}/disputes`,
      form,
      token,
      "Dispute submission failed",
    );
  },
  submitDisputeResponse: (
    token: string,
    orderId: string,
    disputeId: string,
    details: string,
    files: File[] = [],
  ) => {
    const form = new FormData();
    form.append("details", details);
    files.forEach((file) => form.append("files", file));
    return uploadForm<{ data: OrderDispute; message: string }>(
      `/orders/${orderId}/disputes/${disputeId}/responses`,
      form,
      token,
      "Dispute response failed",
    );
  },
  addDisputeEvidence: (
    token: string,
    orderId: string,
    disputeId: string,
    files: File[],
  ) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    return uploadForm<{ data: OrderDispute; message: string }>(
      `/orders/${orderId}/disputes/${disputeId}/evidence`,
      form,
      token,
      "Evidence upload failed",
    );
  },
  disputeEvidence: async (
    token: string,
    orderId: string,
    disputeId: string,
    evidenceId: string,
  ) => {
    const response = await authenticatedFetch(
      `${apiUrl()}/api/v1/orders/${orderId}/disputes/${disputeId}/evidence/${evidenceId}`,
      { cache: "no-store" },
      token,
    );
    if (!response.ok) {
      signalUnauthorized(response.status, true);
      throw new ApiError(response.status, "Unable to download evidence");
    }
    return response.blob();
  },
  orderPayments: (token: string, id: string) =>
    request<{ data: OrderPayment[] }>(
      `/orders/${id}/payments`,
      undefined,
      token,
    ),
  refundEligibility: (token: string, id: string) =>
    request<{ data: RefundEligibility }>(
      `/orders/${id}/payments/refund-eligibility`,
      undefined,
      token,
    ),
  requestFullRefund: (
    token: string,
    id: string,
    reason: Extract<
      MarketplaceRefundReason,
      "PAID_NOT_STARTED" | "MISSED_RUSH_DEADLINE"
    >,
  ) =>
    request<{ data: MarketplaceRefund }>(
      `/orders/${id}/payments/refunds`,
      { method: "POST", body: JSON.stringify({ reason }) },
      token,
    ),
  adminRefunds: (token: string, status?: string) =>
    request<{ data: MarketplaceRefund[] }>(
      `/admin/refunds?limit=50${status ? `&status=${encodeURIComponent(status)}` : ""}`,
      undefined,
      token,
    ),
  staleRevisionRefunds: (token: string) =>
    request<{
      data: {
        id: string;
        orderId: string;
        providerSubtotalCentavos: number;
        platformFeeCentavos: number;
        totalCentavos: number;
        currency: string;
        paidAt: string | null;
        failureCode: string | null;
        order: { orderNumber: string; titleSnapshot: string };
      }[];
    }>("/admin/refunds/stale-revisions", undefined, token),
  refundFromDispute: (token: string, disputeId: string) =>
    request<{ data: MarketplaceRefund }>(
      `/admin/refunds/disputes/${disputeId}`,
      { method: "POST" },
      token,
    ),
  refundStaleRevision: (token: string, revisionPurchaseId: string) =>
    request<{ data: MarketplaceRefund }>(
      `/admin/refunds/stale-revisions/${revisionPurchaseId}`,
      { method: "POST" },
      token,
    ),
  reconcileRefund: (token: string, refundId: string) =>
    request<{ data: MarketplaceRefund }>(
      `/admin/refunds/${refundId}/reconcile`,
      { method: "POST" },
      token,
    ),
  createPaymentCheckout: (token: string, id: string) =>
    request<{
      data: Pick<
        OrderPayment,
        "id" | "amountCentavos" | "currency" | "status" | "createdAt"
      >;
      checkoutUrl: string;
    }>(
      `/orders/${id}/payments/checkout`,
      { method: "POST", body: JSON.stringify({ returnTarget: "WEB" }) },
      token,
    ),
  adminDisputes: (token: string, cursor?: string, status?: string) =>
    request<CursorPage<OrderDispute>>(
      `/admin/disputes?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}${status ? `&status=${encodeURIComponent(status)}` : ""}`,
      undefined,
      token,
    ),
  beginDisputeReview: (token: string, id: string) =>
    request<{ data: OrderDispute }>(
      `/admin/disputes/${id}/review`,
      { method: "POST" },
      token,
    ),
  disputeDetail: (token: string, id: string) =>
    request<{ data: OrderDispute }>(`/admin/disputes/${id}`, undefined, token),
  adminDisputeEvidence: async (
    token: string,
    disputeId: string,
    evidenceId: string,
  ) => {
    const response = await authenticatedFetch(
      `${apiUrl()}/api/v1/admin/disputes/${disputeId}/evidence/${evidenceId}`,
      { cache: "no-store" },
      token,
    );
    if (!response.ok) {
      signalUnauthorized(response.status, true);
      throw new ApiError(response.status, "Unable to download evidence");
    }
    return response.blob();
  },
  requestDisputeResponse: (
    token: string,
    id: string,
    requestedFrom: "CLIENT" | "PROVIDER",
  ) =>
    request<{ data: OrderDispute; message: string }>(
      `/admin/disputes/${id}/request-response`,
      { method: "POST", body: JSON.stringify({ requestedFrom }) },
      token,
    ),
  markDisputeReady: (token: string, id: string) =>
    request<{ data: OrderDispute }>(
      `/admin/disputes/${id}/ready`,
      { method: "POST" },
      token,
    ),
  resolveDispute: (
    token: string,
    id: string,
    status: "RESOLVED_CLIENT" | "RESOLVED_PROVIDER" | "CLOSED",
    resolutionNote: string,
  ) =>
    request<{ data: OrderDispute; message: string }>(
      `/admin/disputes/${id}/resolve`,
      { method: "POST", body: JSON.stringify({ status, resolutionNote }) },
      token,
    ),
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
    const response = await authenticatedFetch(
      `${apiUrl()}/api/v1/orders/${orderId}/messages/attachments`,
      {
        method: "POST",
        cache: "no-store",
        body: form,
      },
      token,
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      signalUnauthorized(response.status, true);
      throw new ApiError(
        response.status,
        Array.isArray(payload?.message)
          ? payload.message.join(" ")
          : (payload?.message ?? "Attachment upload failed"),
      );
    }
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
    clientRequestId: string,
  ) => {
    const form = new FormData();
    form.append("note", note);
    form.append("clientRequestId", clientRequestId);
    files.forEach((file) => form.append("files", file));
    const response = await authenticatedFetch(
      `${apiUrl()}/api/v1/orders/${id}/deliver`,
      { method: "POST", cache: "no-store", body: form },
      token,
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      signalUnauthorized(response.status, true);
      throw new ApiError(
        response.status,
        Array.isArray(body?.message)
          ? body.message.join(" ")
          : (body?.message ?? "Delivery upload failed"),
      );
    }
    return body as { data: MarketplaceOrder; message: string };
  },
  orderFile: async (token: string, orderId: string, fileId: string) => {
    const endpoint = `${apiUrl()}/api/v1/orders/${orderId}/files/${fileId}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await authenticatedFetch(
        endpoint,
        { cache: "no-store" },
        token,
      );
      const expiredRedirect =
        attempt === 0 &&
        response.redirected &&
        (response.status === 400 || response.status === 403);
      if (expiredRedirect) continue;
      if (!response.ok) {
        signalUnauthorized(response.status, true);
        throw new ApiError(response.status, "Unable to download file");
      }
      return response.blob();
    }
    throw new ApiError(502, "Unable to renew the secure download link");
  },
  requestOrderRevision: (token: string, id: string, instructions: string) =>
    request<{ data: MarketplaceOrder; message: string }>(
      `/orders/${id}/revision`,
      { method: "POST", body: JSON.stringify({ instructions }) },
      token,
    ),
  requestProviderCorrection: (
    token: string,
    id: string,
    instructions: string,
  ) =>
    request<{ data: OrderRevision; message: string }>(
      `/orders/${id}/revisions/correction-claim`,
      { method: "POST", body: JSON.stringify({ instructions }) },
      token,
    ),
  decideProviderCorrection: (
    token: string,
    id: string,
    revisionId: string,
    accepted: boolean,
  ) =>
    request<{ data: OrderRevision; message: string }>(
      `/orders/${id}/revisions/${revisionId}/correction-decision`,
      { method: "POST", body: JSON.stringify({ accepted }) },
      token,
    ),
  extraRevisionQuote: (token: string, id: string) =>
    request<{ data: ExtraRevisionQuote }>(
      `/orders/${id}/payments/revision-quote`,
      undefined,
      token,
    ),
  createExtraRevisionCheckout: (
    token: string,
    id: string,
    instructions: string,
  ) =>
    request<{
      data: OrderRevisionPurchase;
      checkoutUrl: string;
    }>(
      `/orders/${id}/payments/revision-checkout`,
      {
        method: "POST",
        body: JSON.stringify({ instructions, returnTarget: "WEB" }),
      },
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
      maxActiveOrders: number;
      maxPendingOrders: number;
      instagramUrl: string | null;
      linkedinUrl: string | null;
      xUrl: string | null;
      portfolioUrl: string | null;
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
    const response = await authenticatedFetch(
      `${apiUrl()}/api/v1/provider/services/${id}/media`,
      {
        method: "POST",
        body: form,
      },
      token,
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      signalUnauthorized(response.status, true);
      throw new ApiError(
        response.status,
        Array.isArray(body?.message)
          ? body.message.join(" ")
          : (body?.message ?? "Media upload failed"),
      );
    }
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
  reviseProviderService: (token: string, id: string) =>
    request<{ data: ProviderService; message: string }>(
      `/provider/services/${id}/revise`,
      { method: "POST" },
      token,
    ),
  transitionProviderService: (
    token: string,
    id: string,
    action: "pause" | "resume" | "archive" | "restore",
  ) =>
    request<{ data: ProviderService; message: string }>(
      `/provider/services/${id}/${action}`,
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
    const response = await authenticatedFetch(
      `${apiUrl()}/api/v1/admin/verifications/${id}/document`,
      {},
      token,
    );
    if (!response.ok) {
      signalUnauthorized(response.status, true);
      throw new ApiError(
        response.status,
        "Unable to open the private document",
      );
    }
    return response.blob();
  },
};

export { backendConfigured };
