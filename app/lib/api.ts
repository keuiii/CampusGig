import type { Category, DashboardStats, Order, ProviderStats, School, Service, Verification } from "../types";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new ApiError(0, "Backend API is not configured");

  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new ApiError(response.status, body?.error?.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

type Collection<T> = T[] | { data: T[] };
const items = <T>(payload: Collection<T>) => Array.isArray(payload) ? payload : payload.data;

export const api = {
  services: async (schoolId?: string) => items(await request<Collection<Service>>(`/services${schoolId ? `?schoolId=${encodeURIComponent(schoolId)}` : ""}`)),
  schools: async () => items(await request<Collection<School>>("/schools")),
  categories: async () => items(await request<Collection<Category>>("/categories")),
  orders: async () => items(await request<Collection<Order>>("/orders")),
  verifications: async () => items(await request<Collection<Verification>>("/admin/verifications")),
  adminStats: () => request<DashboardStats>("/admin/dashboard"),
  providerStats: () => request<ProviderStats>("/provider/dashboard"),
  approveVerification: (id: string) => request<void>(`/admin/verifications/${id}/approve`, { method: "POST" }),
  rejectVerification: (id: string) => request<void>(`/admin/verifications/${id}/reject`, { method: "POST" }),
};

export const backendConfigured = Boolean(API_URL);
