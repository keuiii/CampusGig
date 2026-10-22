const configuredApiUrl =
  process.env.NEXT_PUBLIC_API_URL?.trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/i, "") ?? "";

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

export function signalUnauthorized(status: number, authenticated: boolean) {
  if (status === 401 && authenticated && typeof window !== "undefined")
    window.dispatchEvent(new Event("campusgig:unauthorized"));
}

type RefreshedBrowserSession = {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    displayName: string;
    hasAvatar: boolean;
    status: string;
    roles: string[];
  };
};

let browserRefresh: Promise<RefreshedBrowserSession | null> | null = null;

export function refreshBrowserSession() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (browserRefresh) return browserRefresh;
  browserRefresh = fetch(`${apiUrl()}/api/v1/auth/refresh`, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const session = (await response.json()) as RefreshedBrowserSession;
      window.dispatchEvent(
        new CustomEvent("campusgig:session-refreshed", { detail: session }),
      );
      return session;
    })
    .catch(() => null)
    .finally(() => {
      browserRefresh = null;
    });
  return browserRefresh;
}

export async function authenticatedFetch(
  url: string,
  init: RequestInit,
  token?: string,
) {
  const send = (accessToken?: string) =>
    fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  let response = await send(token);
  if (response.status !== 401 || !token) return response;
  const refreshed = await refreshBrowserSession();
  if (refreshed) response = await send(refreshed.accessToken);
  return response;
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

  const response = await authenticatedFetch(
    `${baseUrl}/api/v1${path}`,
    {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    },
    token,
  );

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    signalUnauthorized(response.status, Boolean(token));
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
  const response = await authenticatedFetch(
    `${apiUrl()}/api/v1${path}`,
    {
      method: "POST",
      cache: "no-store",
      body: form,
    },
    token,
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    signalUnauthorized(response.status, true);
    throw new ApiError(response.status, errorMessage(body, fallbackMessage));
  }
  return body as T;
}

export const backendConfigured = Boolean(configuredApiUrl);
