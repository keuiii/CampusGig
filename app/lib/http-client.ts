const configuredApiUrl =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

export function apiUrl() {
  if (!configuredApiUrl || typeof window === "undefined") {
    return configuredApiUrl;
  }

  try {
    const configured = new URL(configuredApiUrl);
    const isRemoteBrowser = !["localhost", "127.0.0.1"].includes(
      window.location.hostname,
    );
    const usesLoopbackApi = ["localhost", "127.0.0.1"].includes(
      configured.hostname,
    );

    if (isRemoteBrowser && usesLoopbackApi) {
      configured.hostname = window.location.hostname;
      return configured.toString().replace(/\/$/, "");
    }
  } catch {
    // A malformed environment value is reported by request() below.
  }

  return configuredApiUrl;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function errorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const response = body as {
    message?: string | string[];
    error?: { message?: string };
  };
  if (Array.isArray(response.message)) return response.message.join(" ");
  return response.message ?? response.error?.message ?? fallback;
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  token?: string,
): Promise<T> {
  const baseUrl = apiUrl();
  if (!baseUrl) throw new ApiError(0, "Backend API is not configured");

  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, errorMessage(body, "Request failed"));
  }

  return response.json() as Promise<T>;
}

export async function uploadForm<T>(
  path: string,
  form: FormData,
  token: string,
  fallbackMessage: string,
) {
  const response = await fetch(`${apiUrl()}/api/v1${path}`, {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(body, fallbackMessage));
  }
  return body as T;
}

export const backendConfigured = Boolean(configuredApiUrl);
