export type WebView =
  | "home"
  | "service"
  | "provider-profile"
  | "orders"
  | "provider"
  | "admin"
  | "school-admin"
  | "access";

export type WebRouteState = {
  view: WebView;
  serviceId?: string;
  providerId?: string;
  orderId?: string;
  returnTo?: "home" | "service" | "provider-profile";
};

const WEB_VIEWS = new Set<WebView>([
  "home",
  "service",
  "provider-profile",
  "orders",
  "provider",
  "admin",
  "school-admin",
  "access",
]);

export function readWebRoute(search: string): WebRouteState {
  const params = new URLSearchParams(search);
  const candidate = params.get("view") as WebView | null;
  const view = candidate && WEB_VIEWS.has(candidate) ? candidate : "home";
  const serviceId = params.get("serviceId") || undefined;
  const providerId = params.get("providerId") || undefined;
  const orderId = params.get("orderId") || undefined;
  const returnCandidate = params.get("returnTo");
  const returnTo =
    returnCandidate === "home" ||
    returnCandidate === "service" ||
    returnCandidate === "provider-profile"
      ? returnCandidate
      : undefined;

  if (view === "service" && !serviceId) return { view: "home" };
  if (view === "provider-profile" && !providerId) return { view: "home" };
  if (view === "service") return { view, serviceId, returnTo };
  if (view === "provider-profile") return { view, providerId, returnTo };
  if (view === "orders") return { view, orderId };
  return { view };
}

export function writeWebRoute(
  currentUrl: string,
  route: WebRouteState,
): string {
  const url = new URL(currentUrl);
  for (const key of ["view", "serviceId", "providerId", "returnTo"]) {
    url.searchParams.delete(key);
  }

  // Keep the marketplace URL clean while still preserving all non-routing
  // parameters (including payment-return parameters handled by the app).
  if (route.view !== "home") url.searchParams.set("view", route.view);
  if (route.view === "service" && route.serviceId) {
    url.searchParams.set("serviceId", route.serviceId);
  }
  if (route.view === "provider-profile" && route.providerId) {
    url.searchParams.set("providerId", route.providerId);
  }
  if (route.returnTo) url.searchParams.set("returnTo", route.returnTo);
  if (route.view === "orders" && route.orderId) {
    url.searchParams.set("orderId", route.orderId);
  } else if (!url.searchParams.has("payment")) {
    url.searchParams.delete("orderId");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
