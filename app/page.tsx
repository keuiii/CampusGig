"use client";

/* eslint-disable @next/next/no-img-element -- Avatar URLs use the runtime-configured CampusGig API origin. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultCategories } from "./catalog";
import { Icon, Logo } from "./components/brand";
import { AndroidAppDownload } from "./components/android-app-download";
import { useAppDialog } from "./components/app-dialog";
import { UnifiedAccount } from "./features/account/UnifiedAccount";
import { WebAccountProfile } from "./features/account/WebAccountProfile";
import { clearLegacyTrustedDeviceStorage } from "./features/account/trusted-device-storage";
import { useWebSession } from "./features/account/use-web-session";
import { useRealtimeSync } from "./features/realtime/use-realtime-sync";
import { OrdersView } from "./features/orders/OrdersView";
import { Home, ServiceDetail } from "./features/marketplace/MarketplaceViews";
import {
  type MarketplaceBudgetRange,
  type MarketplaceSort,
} from "./features/marketplace/marketplace-filter";
import { PublicProviderProfileView } from "./features/marketplace/PublicProviderProfileView";
import { ProviderDashboard } from "./features/provider/ProviderDashboard";
import { ProviderAccessGuide } from "./features/provider/ProviderAccessGuide";
import { AdminDashboard } from "./features/admin/AdminDashboard";
import { SchoolAdminDashboard } from "./features/admin/SchoolAdminDashboard";
import { api, backendConfigured } from "./lib/api";
import {
  readWebRoute,
  writeWebRoute,
  type WebRouteState,
  type WebView,
} from "./lib/web-route-state";
import {
  applySchoolStatusUpdate,
  retainActiveSchoolSelection,
} from "./lib/school-state";
import {
  preferredMobileReturnUrl,
  readMobilePaymentReturn,
  type MobilePaymentReturn,
} from "./lib/mobile-payment-return";
import type {
  AppNotification,
  AuthUser,
  Category,
  MarketplaceOrder,
  School,
  Service,
} from "./types";

type View = WebView;

export default function CampusGigApp() {
  const appDialog = useAppDialog();
  const [view, setView] = useState<View>("home");
  const [selected, setSelected] = useState<Service | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [providerProfileReturnView, setProviderProfileReturnView] = useState<
    "home" | "service"
  >("service");
  const [serviceReturnView, setServiceReturnView] = useState<
    "home" | "provider-profile"
  >("home");
  const [services, setServices] = useState<Service[]>([]);
  const [serviceTotal, setServiceTotal] = useState(0);
  const [servicesHaveMore, setServicesHaveMore] = useState(false);
  const [servicesLoadingMore, setServicesLoadingMore] = useState(false);
  const [servicesError, setServicesError] = useState("");
  const servicePageRef = useRef(1);
  const serviceRequestRef = useRef(0);
  const serviceFilterKeyRef = useRef("");
  const serviceAbortRef = useRef<AbortController | null>(null);
  const [categories, setCategories] = useState<Category[]>(defaultCategories);
  const [schools, setSchools] = useState<School[]>([]);
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false);
  const [ordersNextCursor, setOrdersNextCursor] = useState<string | null>(null);
  const [ordersHaveMore, setOrdersHaveMore] = useState(false);
  const orderPagesLoadedRef = useRef(1);
  const [loading, setLoading] = useState(backendConfigured);
  const [savedServiceIds, setSavedServiceIds] = useState<Set<string>>(
    new Set(),
  );
  const [savedOnly, setSavedOnly] = useState(false);
  const [savingServiceId, setSavingServiceId] = useState("");
  const savingServiceRef = useRef(false);
  const savedAccountRef = useRef("");
  const orderSubmissionRef = useRef<{
    fingerprint: string;
    clientRequestId: string;
  } | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(Date.now());
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [budgetRange, setBudgetRange] = useState<MarketplaceBudgetRange>("any");
  const [minimumRating, setMinimumRating] = useState(0);
  const [maximumDeliveryDays, setMaximumDeliveryDays] = useState(0);
  const [marketplaceSort, setMarketplaceSort] =
    useState<MarketplaceSort>("recommended");
  const [toast, setToast] = useState("");
  const [mobilePaymentReturn, setMobilePaymentReturn] =
    useState<MobilePaymentReturn | null>(null);
  const [headerNotifications, setHeaderNotifications] = useState<
    AppNotification[]
  >([]);
  const [headerUnreadCount, setHeaderUnreadCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const [readingAllNotifications, setReadingAllNotifications] = useState(false);
  const [incomingNotification, setIncomingNotification] =
    useState<AppNotification | null>(null);
  const [nightMode, setNightMode] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [pageScrolled, setPageScrolled] = useState(false);
  const [notificationOrderId, setNotificationOrderId] = useState<string | null>(
    null,
  );
  const [pendingRoute, setPendingRoute] = useState<WebRouteState | null>(null);
  const [routeRestored, setRouteRestored] = useState(false);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);
  const handleSessionUnauthorized = useCallback(() => {
    setHeaderNotifications([]);
    setHeaderUnreadCount(0);
    setNotificationsOpen(false);
    setView("access");
    window.scrollTo({ top: 0, behavior: "smooth" });
    notify("Your session ended. Please sign in again.");
  }, [notify]);
  const {
    token: webToken,
    user: webUser,
    setUser: setWebUser,
    applySession: applyWebSession,
    clearSession: clearLocalWebSession,
  } = useWebSession(handleSessionUnauthorized);
  const handleOrderOpened = useCallback(() => setNotificationOrderId(null), []);

  useEffect(() => {
    clearLegacyTrustedDeviceStorage(window.localStorage);
  }, []);

  useEffect(() => {
    if (!notificationsOpen) return;

    const dismissOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !notificationMenuRef.current?.contains(target)
      ) {
        setNotificationsOpen(false);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };

    document.addEventListener("pointerdown", dismissOnOutsidePress);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePress);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    setNotificationsOpen(false);
  }, [view]);

  useEffect(() => {
    const restore = () => {
      setRouteRestored(false);
      setPendingRoute(readWebRoute(window.location.search));
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (!pendingRoute) return;
    if (pendingRoute.view === "service") {
      if (loading) return;
      const service = services.find(
        (item) => item.id === pendingRoute.serviceId,
      );
      if (!service) {
        setView("home");
      } else {
        setSelected(service);
        setServiceReturnView(
          pendingRoute.returnTo === "provider-profile"
            ? "provider-profile"
            : "home",
        );
        setView("service");
      }
    } else if (pendingRoute.view === "provider-profile") {
      setSelectedProviderId(pendingRoute.providerId ?? "");
      setProviderProfileReturnView(
        pendingRoute.returnTo === "service" ? "service" : "home",
      );
      setView("provider-profile");
    } else {
      setView(pendingRoute.view);
      setNotificationOrderId(pendingRoute.orderId ?? null);
    }
    setPendingRoute(null);
    setRouteRestored(true);
  }, [loading, pendingRoute, services]);

  useEffect(() => {
    if (!routeRestored) return;
    const route: WebRouteState = { view };
    if (view === "service" && selected) {
      route.serviceId = selected.id;
      route.returnTo = serviceReturnView;
    } else if (view === "provider-profile" && selectedProviderId) {
      route.providerId = selectedProviderId;
      route.returnTo = providerProfileReturnView;
    } else if (view === "orders" && notificationOrderId) {
      route.orderId = notificationOrderId;
    }
    window.history.replaceState(
      {},
      "",
      writeWebRoute(window.location.href, route),
    );
  }, [
    notificationOrderId,
    providerProfileReturnView,
    routeRestored,
    selected,
    selectedProviderId,
    serviceReturnView,
    view,
  ]);

  useEffect(() => {
    const paymentReturn = readMobilePaymentReturn(window.location.search);
    if (!paymentReturn) return;
    setMobilePaymentReturn(paymentReturn);
    window.location.replace(
      preferredMobileReturnUrl(paymentReturn, window.navigator.userAgent),
    );
  }, []);

  useEffect(() => {
    const enabled =
      window.localStorage.getItem("campusgig.nightMode") === "true";
    setNightMode(enabled);
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
  }, []);

  useEffect(() => {
    if (!webToken || !orders.length) return;
    const url = new URL(window.location.href);
    const payment = url.searchParams.get("payment");
    const orderId = url.searchParams.get("orderId");
    const revisionPurchaseId = url.searchParams.get("revisionPurchaseId");
    if (!payment || !orderId || !orders.some((order) => order.id === orderId))
      return;
    setNotificationOrderId(orderId);
    setView("orders");
    notify(
      payment === "success"
        ? "Payment submitted. Waiting for PayMongo confirmation."
        : "Payment checkout was cancelled.",
    );
    const pendingPaymentKey = revisionPurchaseId
      ? "campusgig.revisionPaymentReturnOrderId"
      : "campusgig.paymentReturnOrderId";
    if (payment === "success")
      window.sessionStorage.setItem(pendingPaymentKey, orderId);
    else window.sessionStorage.removeItem(pendingPaymentKey);
    url.searchParams.delete("payment");
    url.searchParams.delete("orderId");
    url.searchParams.delete("revisionPurchaseId");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [notify, orders, webToken]);

  useEffect(() => {
    let frame = 0;
    const updateScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const maximum =
          document.documentElement.scrollHeight - window.innerHeight;
        setScrollProgress(
          maximum > 0 ? Math.min(100, (window.scrollY / maximum) * 100) : 0,
        );
        setPageScrolled(window.scrollY > 18);
      });
    };
    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });
    window.addEventListener("resize", updateScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateScroll);
      window.removeEventListener("resize", updateScroll);
    };
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const selector =
      "section, footer, .service-card, .category-card, .panel, .stat-card, .access-card, .provider-request, .table-card, .how-step";
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("motion-visible");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.08, rootMargin: "0px 0px -35px" },
    );
    const observeNewElements = () =>
      document.querySelectorAll(selector).forEach((element) => {
        if (!element.classList.contains("motion-reveal")) {
          element.classList.add("motion-reveal");
          observer.observe(element);
        }
      });
    observeNewElements();
    document.documentElement.classList.add("motion-ready");
    const mutations = new MutationObserver(observeNewElements);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
      document.documentElement.classList.remove("motion-ready");
    };
  }, []);

  function toggleNightMode() {
    const enabled = !nightMode;
    setNightMode(enabled);
    window.localStorage.setItem("campusgig.nightMode", String(enabled));
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
  }

  const serviceFilters = useMemo(
    () => ({
      query: query.trim().replace(/\s+/g, " "),
      category: activeCategory,
      schoolId: selectedSchoolId,
      budgetRange,
      minimumRating,
      maximumDeliveryDays,
      sort: marketplaceSort,
    }),
    [
      query,
      activeCategory,
      selectedSchoolId,
      budgetRange,
      minimumRating,
      maximumDeliveryDays,
      marketplaceSort,
    ],
  );
  const savedToken = savedOnly ? webToken : undefined;
  const serviceFilterKey = JSON.stringify([
    serviceFilters,
    savedOnly,
    webUser?.id,
  ]);

  useEffect(() => {
    const accountId = webUser?.id ?? "";
    if (savedAccountRef.current === accountId) return;
    savedAccountRef.current = accountId;
    setSavedServiceIds(new Set());
    setSavedOnly(false);
  }, [webUser?.id]);

  useEffect(() => {
    if (!webToken) {
      setSavedServiceIds(new Set());
      setSavedOnly(false);
      return;
    }
    let active = true;
    void api
      .savedServiceIds(webToken)
      .then(({ data }) => {
        if (active) setSavedServiceIds(new Set(data));
      })
      .catch(() => {
        if (active) setSavedServiceIds(new Set());
      });
    return () => {
      active = false;
    };
  }, [webToken]);

  async function toggleSavedService(serviceId: string) {
    if (!webToken) {
      navigate("access");
      notify("Sign in to save services.");
      return;
    }
    if (savingServiceRef.current) return;
    const accountId = webUser?.id ?? "";
    savingServiceRef.current = true;
    setSavingServiceId(serviceId);
    const wasSaved = savedServiceIds.has(serviceId);
    try {
      if (wasSaved) await api.unsaveService(webToken, serviceId);
      else await api.saveService(webToken, serviceId);
      if (savedAccountRef.current !== accountId) return;
      setSavedServiceIds((current) => {
        const next = new Set(current);
        if (wasSaved) next.delete(serviceId);
        else next.add(serviceId);
        return next;
      });
      if (savedOnly) await refreshMarketplace();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not update saved services.",
      );
    } finally {
      savingServiceRef.current = false;
      setSavingServiceId("");
    }
  }

  const refreshMarketplace = useCallback(async () => {
    serviceAbortRef.current?.abort();
    const controller = new AbortController();
    serviceAbortRef.current = controller;
    const requestId = ++serviceRequestRef.current;
    const filtersChanged = serviceFilterKeyRef.current !== serviceFilterKey;
    if (filtersChanged) {
      serviceFilterKeyRef.current = serviceFilterKey;
      servicePageRef.current = 1;
      setServicesLoadingMore(false);
      setServices([]);
      setServiceTotal(0);
      setServicesHaveMore(false);
      setLoading(true);
    }
    const pagesToRefresh = servicePageRef.current;
    const [serviceResult, categoryResult, schoolResult, savedResult] =
      await Promise.allSettled([
        (async () => {
          const pages = [];
          for (let page = 1; page <= pagesToRefresh; page++) {
            const result = await api.services(
              serviceFilters,
              page,
              savedToken,
              controller.signal,
            );
            pages.push(result);
            if (!result.hasMore) break;
          }
          return pages;
        })(),
        api.categories(),
        api.schools(),
        webToken
          ? api.savedServiceIds(webToken)
          : Promise.resolve({ data: [] }),
      ]);
    if (requestId !== serviceRequestRef.current) return;
    if (serviceResult.status === "fulfilled") {
      const pages = serviceResult.value;
      const last = pages.at(-1);
      const unique = new Map(
        pages
          .flatMap((page) => page.data)
          .map((service) => [service.id, service]),
      );
      setServices([...unique.values()]);
      setServiceTotal(last?.total ?? 0);
      setServicesHaveMore(last?.hasMore ?? false);
      servicePageRef.current = last?.page ?? 1;
      setServicesError("");
    } else if (
      !(
        serviceResult.reason instanceof DOMException &&
        serviceResult.reason.name === "AbortError"
      )
    )
      setServicesError("Could not refresh services. Try again.");
    setLoading(false);
    if (
      categoryResult.status === "fulfilled" &&
      categoryResult.value.length > 0
    )
      setCategories(categoryResult.value);
    if (schoolResult.status === "fulfilled") {
      setSchools(schoolResult.value);
      setSelectedSchoolId((selectedId) =>
        retainActiveSchoolSelection(selectedId, schoolResult.value),
      );
    }
    if (
      savedResult.status === "fulfilled" &&
      savedAccountRef.current === (webUser?.id ?? "")
    )
      setSavedServiceIds(new Set(savedResult.value.data));
    if (serviceAbortRef.current === controller) serviceAbortRef.current = null;
  }, [serviceFilterKey, serviceFilters, savedToken, webToken, webUser?.id]);

  useEffect(() => {
    if (!backendConfigured) return;
    const timer = window.setTimeout(() => {
      void refreshMarketplace().finally(() => setLoading(false));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      serviceAbortRef.current?.abort();
    };
  }, [refreshMarketplace]);

  useEffect(() => {
    if (!backendConfigured || view !== "home") return;
    const refresh = () => void refreshMarketplace();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshMarketplace, view]);

  function handleSchoolStatusChanged(updated: School) {
    setSchools((current) => applySchoolStatusUpdate(current, updated));
    if (updated.status !== "ACTIVE")
      setSelectedSchoolId((selectedId) =>
        selectedId === updated.id ? "" : selectedId,
      );
    void refreshMarketplace();
  }

  const refreshClientOrders = useCallback(async () => {
    if (!webToken) {
      setOrders([]);
      return;
    }
    setOrdersLoading(true);
    try {
      const refreshed: MarketplaceOrder[] = [];
      let cursor: string | undefined;
      let page = 0;
      let result = await api.clientOrders(webToken);
      while (true) {
        refreshed.push(...result.data);
        page += 1;
        if (!result.pagination.hasMore || page >= orderPagesLoadedRef.current)
          break;
        cursor = result.pagination.nextCursor ?? undefined;
        if (!cursor) break;
        result = await api.clientOrders(webToken, cursor);
      }
      setOrders(
        Array.from(
          new Map(refreshed.map((order) => [order.id, order])).values(),
        ),
      );
      setOrdersNextCursor(result.pagination.nextCursor);
      setOrdersHaveMore(result.pagination.hasMore);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load orders");
    } finally {
      setOrdersLoading(false);
    }
  }, [notify, webToken]);

  const loadMoreClientOrders = useCallback(async () => {
    if (!webToken || !ordersNextCursor || ordersLoadingMore) return;
    setOrdersLoadingMore(true);
    try {
      const result = await api.clientOrders(webToken, ordersNextCursor);
      setOrders((current) =>
        Array.from(
          new Map(
            [...current, ...result.data].map((order) => [order.id, order]),
          ).values(),
        ),
      );
      orderPagesLoadedRef.current += 1;
      setOrdersNextCursor(result.pagination.nextCursor);
      setOrdersHaveMore(result.pagination.hasMore);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Unable to load more orders",
      );
    } finally {
      setOrdersLoadingMore(false);
    }
  }, [notify, ordersLoadingMore, ordersNextCursor, webToken]);

  useEffect(() => {
    void refreshClientOrders();
  }, [refreshClientOrders]);

  useEffect(() => {
    if (!webToken) return;
    let initialized = false;
    let knownIds = new Set<string>();
    let dismissTimer: number | undefined;
    const refreshNotifications = () =>
      api
        .notifications(webToken)
        .then((result) => {
          if (initialized) {
            const incoming = result.data.find(
              (item) => !item.readAt && !knownIds.has(item.id),
            );
            if (incoming) {
              setIncomingNotification(incoming);
              if (dismissTimer) window.clearTimeout(dismissTimer);
              dismissTimer = window.setTimeout(
                () => setIncomingNotification(null),
                6500,
              );
            }
          }
          knownIds = new Set(result.data.map((item) => item.id));
          initialized = true;
          setHeaderNotifications(result.data);
          setHeaderUnreadCount(result.unreadCount);
        })
        .catch(() => undefined);
    void refreshNotifications();
    const timer = window.setInterval(() => void refreshNotifications(), 5000);
    const handleRealtimeNotification = () => void refreshNotifications();
    window.addEventListener(
      "campusgig:notifications-changed",
      handleRealtimeNotification,
    );
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(
        "campusgig:notifications-changed",
        handleRealtimeNotification,
      );
      if (dismissTimer) window.clearTimeout(dismissTimer);
    };
  }, [webToken]);

  useRealtimeSync(webToken, refreshClientOrders, refreshMarketplace);

  function routeAccount(user: AuthUser) {
    if (user.roles.includes("ADMIN")) navigate("admin");
    else if (user.roles.includes("SCHOOL_ADMIN")) navigate("school-admin");
    else if (user.roles.includes("PROVIDER")) navigate("provider");
    else navigate("access");
  }

  function setWebSession(token: string, user: AuthUser) {
    applyWebSession(token, user);
    routeAccount(user);
  }

  function clearWebSession(showConfirmation = true) {
    void api.logout().catch(() => undefined);
    clearLocalWebSession();
    setHeaderNotifications([]);
    setHeaderUnreadCount(0);
    setNotificationsOpen(false);
    navigate("access");
    if (showConfirmation) notify("Signed out");
  }

  async function toggleNotifications() {
    if (!webToken) return navigate("access");
    if (notificationsOpen) return setNotificationsOpen(false);
    try {
      const result = await api.notifications(webToken);
      setHeaderNotifications(result.data);
      setHeaderUnreadCount(result.unreadCount);
      setNotificationsOpen(true);
    } catch {
      notify("Unable to load notifications");
    }
  }

  async function readHeaderNotification(item: AppNotification) {
    if (!item.readAt) {
      await api.markNotificationRead(webToken, item.id);
      setHeaderNotifications((items) =>
        items.map((entry) =>
          entry.id === item.id
            ? { ...entry, readAt: new Date().toISOString() }
            : entry,
        ),
      );
      setHeaderUnreadCount((count) => Math.max(0, count - 1));
    }
    setNotificationsOpen(false);
    setIncomingNotification(null);
    if (item.orderId) {
      setNotificationOrderId(item.orderId);
      const providerOnlyTypes = new Set([
        "NEW_ORDER",
        "REVISION_REQUESTED",
        "ORDER_COMPLETED",
        "NEW_REVIEW",
      ]);
      const belongsToClientOrders = orders.some(
        (order) => order.id === item.orderId,
      );
      if (
        webUser?.roles.includes("PROVIDER") &&
        (providerOnlyTypes.has(item.type) ||
          (item.type === "NEW_MESSAGE" && !belongsToClientOrders))
      ) {
        navigate("provider");
      } else navigate("orders");
    }
  }

  async function readAllNotifications() {
    if (!webToken || headerUnreadCount === 0 || readingAllNotifications) return;
    if (
      !(await appDialog.confirm({
        title: "Mark all as read?",
        message: `This will clear ${headerUnreadCount} unread notification${headerUnreadCount === 1 ? "" : "s"} from your notification counter.`,
        confirmLabel: "Read all",
        cancelLabel: "Keep unread",
      }))
    )
      return;
    setReadingAllNotifications(true);
    try {
      const result = await api.markAllNotificationsRead(webToken);
      const readAt = new Date().toISOString();
      setHeaderNotifications((items) =>
        items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
      );
      setHeaderUnreadCount(0);
      setIncomingNotification(null);
      notify(result.message);
    } catch {
      notify("Unable to mark notifications as read");
    } finally {
      setReadingAllNotifications(false);
    }
  }

  async function loadMoreServices() {
    if (servicesLoadingMore || !servicesHaveMore) return;
    serviceAbortRef.current?.abort();
    const controller = new AbortController();
    serviceAbortRef.current = controller;
    setServicesLoadingMore(true);
    const requestId = ++serviceRequestRef.current;
    try {
      const result = await api.services(
        serviceFilters,
        servicePageRef.current + 1,
        savedToken,
        controller.signal,
      );
      if (requestId !== serviceRequestRef.current) return;
      setServices((current) => {
        const unique = new Map(current.map((service) => [service.id, service]));
        for (const service of result.data) unique.set(service.id, service);
        return [...unique.values()];
      });
      servicePageRef.current = result.page;
      setServiceTotal(result.total);
      setServicesHaveMore(result.hasMore);
      setServicesError("");
    } catch (error) {
      if (
        requestId === serviceRequestRef.current &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        setServicesError("Could not load more services. Try again.");
    } finally {
      if (requestId === serviceRequestRef.current) {
        setServicesLoadingMore(false);
        if (serviceAbortRef.current === controller)
          serviceAbortRef.current = null;
      }
    }
  }

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openService(
    service: Service,
    returnTo: "home" | "provider-profile" = "home",
  ) {
    setSelected(service);
    setServiceReturnView(returnTo);
    navigate("service");
  }

  function openProviderProfile(
    providerId: string,
    returnTo: "home" | "service",
  ) {
    setSelectedProviderId(providerId);
    setProviderProfileReturnView(returnTo);
    navigate("provider-profile");
  }

  async function createWebOrder(
    serviceId: string,
    servicePackageId: string | undefined,
    requirements: string,
    requestedDeliveryDate: string | undefined,
    deliveryOption?: import("./types").DeliveryOption,
  ) {
    if (!webToken) {
      notify("Sign in before sending a service request");
      navigate("access");
      return;
    }
    const normalizedRequirements = requirements.trim();
    const fingerprint = JSON.stringify({
      serviceId,
      servicePackageId,
      requirements: normalizedRequirements,
      requestedDeliveryDate,
      deliveryOption,
    });
    if (orderSubmissionRef.current?.fingerprint !== fingerprint)
      orderSubmissionRef.current = {
        fingerprint,
        clientRequestId: globalThis.crypto.randomUUID(),
      };
    const result = await api.createOrder(webToken, {
      clientRequestId: orderSubmissionRef.current.clientRequestId,
      serviceId,
      servicePackageId,
      requirements: normalizedRequirements,
      requestedDeliveryDate,
      deliveryOption,
    });
    orderSubmissionRef.current = null;
    setOrders((current) => [
      result.data,
      ...current.filter((order) => order.id !== result.data.id),
    ]);
    setNotificationOrderId(result.data.id);
    notify(`Request ${result.data.orderNumber} sent`);
    navigate("orders");
  }

  return (
    <div className={`app-shell ${view === "admin" ? "admin-app-shell" : ""}`}>
      <div className="scroll-progress" aria-hidden="true">
        <span style={{ width: `${scrollProgress}%` }} />
      </div>
      <header className={`topbar ${pageScrolled ? "scrolled" : ""}`}>
        <div className="nav-wrap">
          <Logo onClick={() => navigate("home")} />
          <nav>
            <button
              className={view === "home" ? "active" : ""}
              onClick={() => navigate("home")}
            >
              Discover
            </button>
            <button
              className={view === "orders" ? "active" : ""}
              onClick={() => navigate("orders")}
            >
              My orders
            </button>
            <button
              className={view === "provider" ? "active" : ""}
              onClick={() => navigate("provider")}
            >
              For providers
            </button>
          </nav>
          <div className="nav-actions">
            <AndroidAppDownload />
            <button
              className={`web-theme-toggle ${nightMode ? "dark" : ""}`}
              role="switch"
              aria-checked={nightMode}
              aria-label="Toggle night mode"
              onClick={toggleNightMode}
            >
              <span className="theme-sun">☀</span>
              <span className="theme-moon">☾</span>
              <i>{nightMode ? "☾" : "☀"}</i>
            </button>
            <div className="notification-menu" ref={notificationMenuRef}>
              <button
                className="icon-button"
                aria-label="Notifications"
                aria-expanded={notificationsOpen}
                onClick={() => void toggleNotifications()}
              >
                <Icon name="bell" />
                {headerUnreadCount > 0 && (
                  <span className="notification-count">
                    {headerUnreadCount > 9 ? "9+" : headerUnreadCount}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="notification-dropdown">
                  <div className="notification-dropdown-head">
                    <div>
                      <span className="kicker">NOTIFICATIONS</span>
                      <b>Account activity</b>
                    </div>
                    <div className="notification-dropdown-actions">
                      <small>{headerUnreadCount} unread</small>
                      {headerUnreadCount > 0 && (
                        <button
                          disabled={readingAllNotifications}
                          onClick={() => void readAllNotifications()}
                        >
                          {readingAllNotifications ? "Marking..." : "Read all"}
                        </button>
                      )}
                    </div>
                  </div>
                  {headerNotifications.length ? (
                    headerNotifications.slice(0, 8).map((item) => (
                      <button
                        key={item.id}
                        className={item.readAt ? "read" : "unread"}
                        onClick={() => void readHeaderNotification(item)}
                      >
                        <span>
                          {item.type === "NEW_MESSAGE"
                            ? "✉"
                            : item.type === "NEW_ORDER"
                              ? "↗"
                              : item.type === "ORDER_ACCEPTED"
                                ? "✓"
                                : "!"}
                        </span>
                        <div>
                          <b>{item.title}</b>
                          <small>{item.body}</small>
                          <time>
                            {new Date(item.createdAt).toLocaleString()}
                          </time>
                        </div>
                        {!item.readAt && <i />}
                      </button>
                    ))
                  ) : (
                    <div className="notification-empty">
                      <span>♧</span>
                      <b>No notifications yet</b>
                      <small>New order activity will appear here.</small>
                    </div>
                  )}
                </div>
              )}
            </div>
            <button className="profile-chip" onClick={() => navigate("access")}>
              <span className="avatar small">
                {webUser?.hasAvatar ? (
                  <img
                    src={api.avatarUrl(webUser.id, avatarVersion)}
                    alt=""
                    width={40}
                    height={40}
                    decoding="async"
                  />
                ) : webUser ? (
                  webUser.displayName.slice(0, 2).toUpperCase()
                ) : (
                  "?"
                )}
              </span>
              <span>{webUser?.displayName ?? "Account"}</span>
            </button>
          </div>
        </div>
      </header>

      <div key={view} className="view-transition">
        {view === "home" && (
          <Home
            query={query}
            setQuery={setQuery}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            categories={categories}
            schools={schools}
            selectedSchoolId={selectedSchoolId}
            setSelectedSchoolId={setSelectedSchoolId}
            budgetRange={budgetRange}
            setBudgetRange={setBudgetRange}
            minimumRating={minimumRating}
            setMinimumRating={setMinimumRating}
            maximumDeliveryDays={maximumDeliveryDays}
            setMaximumDeliveryDays={setMaximumDeliveryDays}
            marketplaceSort={marketplaceSort}
            setMarketplaceSort={setMarketplaceSort}
            savedOnly={savedOnly}
            setSavedOnly={setSavedOnly}
            signedIn={Boolean(webToken)}
            savedServiceIds={savedServiceIds}
            savingServiceId={savingServiceId}
            toggleSavedService={toggleSavedService}
            filtered={services}
            serviceTotal={serviceTotal}
            servicesHaveMore={servicesHaveMore}
            servicesLoadingMore={servicesLoadingMore}
            servicesError={servicesError}
            retryServices={() => void refreshMarketplace()}
            loadMoreServices={loadMoreServices}
            loading={loading}
            openService={openService}
            openProvider={openProviderProfile}
          />
        )}
        {view === "service" && selected && (
          <ServiceDetail
            service={selected}
            authenticated={Boolean(webToken)}
            token={webToken}
            onBook={createWebOrder}
            back={() => navigate(serviceReturnView)}
            openProvider={() =>
              openProviderProfile(selected.providerId, "service")
            }
          />
        )}
        {view === "provider-profile" && selectedProviderId && (
          <PublicProviderProfileView
            providerId={selectedProviderId}
            token={webToken}
            back={() => navigate(providerProfileReturnView)}
            backLabel={
              providerProfileReturnView === "service"
                ? "Back to service"
                : "Back to marketplace"
            }
            openService={(service) => openService(service, "provider-profile")}
          />
        )}
        {view === "orders" &&
          (webToken && webUser ? (
            <OrdersView
              token={webToken}
              orders={orders}
              loading={ordersLoading}
              loadingMore={ordersLoadingMore}
              hasMore={ordersHaveMore}
              loadMore={loadMoreClientOrders}
              refresh={refreshClientOrders}
              openOrderId={notificationOrderId}
              onOrderOpened={handleOrderOpened}
            />
          ) : (
            <UnifiedAccount onAuthenticated={setWebSession} />
          ))}
        {view === "provider" &&
          (webToken && webUser?.roles.includes("PROVIDER") ? (
            <ProviderDashboard
              token={webToken}
              user={webUser}
              categories={categories}
              notify={notify}
              onLogout={clearWebSession}
              openOrderId={notificationOrderId}
              onOrderOpened={handleOrderOpened}
            />
          ) : webToken && webUser ? (
            <ProviderAccessGuide
              token={webToken}
              user={webUser}
              onOpenAccount={() => navigate("access")}
              onAccountRefreshed={setWebUser}
            />
          ) : (
            <UnifiedAccount onAuthenticated={setWebSession} />
          ))}
        {view === "admin" &&
          (webToken && webUser?.roles.includes("ADMIN") ? (
            <AdminDashboard
              token={webToken}
              notify={notify}
              onSchoolStatusChanged={handleSchoolStatusChanged}
              onExit={() => navigate("home")}
            />
          ) : (
            <UnifiedAccount onAuthenticated={setWebSession} />
          ))}
        {view === "school-admin" &&
          (webToken && webUser?.roles.includes("SCHOOL_ADMIN") ? (
            <SchoolAdminDashboard
              token={webToken}
              user={webUser}
              notify={notify}
              onLogout={clearWebSession}
            />
          ) : (
            <UnifiedAccount onAuthenticated={setWebSession} />
          ))}
        {view === "access" &&
          (webUser ? (
            <WebAccountProfile
              token={webToken}
              user={webUser}
              avatarVersion={avatarVersion}
              notify={notify}
              onAvatarChanged={() => {
                setWebUser((current) =>
                  current ? { ...current, hasAvatar: true } : current,
                );
                setAvatarVersion(Date.now());
              }}
              onOpenWorkspace={() => routeAccount(webUser)}
              onLogout={clearWebSession}
            />
          ) : (
            <UnifiedAccount onAuthenticated={setWebSession} />
          ))}
      </div>

      {toast && (
        <div className="toast">
          <span className="toast-check">
            <Icon name="check" />
          </span>
          {toast}
        </div>
      )}
      {mobilePaymentReturn && (
        <section
          className="mobile-payment-return"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-payment-return-title"
        >
          <div>
            <span className="kicker">PAYMENT CHECKOUT</span>
            <h2 id="mobile-payment-return-title">
              {mobilePaymentReturn.status === "success"
                ? "Payment submitted"
                : "Checkout cancelled"}
            </h2>
            <p>
              Return to CampusGig to refresh the order. Payment is confirmed
              securely after PayMongo sends its signed notification.
            </p>
            <a href={mobilePaymentReturn.deepLink}>Return to CampusGig</a>
            <small>
              If the app does not open, confirm CampusGig is installed and tap
              the button again.
            </small>
          </div>
        </section>
      )}
      {incomingNotification && (
        <button
          className="incoming-notification"
          onClick={() => void readHeaderNotification(incomingNotification)}
        >
          <span>✉</span>
          <div>
            <small>NEW MESSAGE</small>
            <b>{incomingNotification.title}</b>
            <p>{incomingNotification.body}</p>
          </div>
          <i>Open →</i>
        </button>
      )}
      {appDialog.dialog}
    </div>
  );
}
