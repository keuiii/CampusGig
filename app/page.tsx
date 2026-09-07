"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultCategories } from "./catalog";
import { Icon, Logo } from "./components/brand";
import { UnifiedAccount } from "./features/account/UnifiedAccount";
import { WebAccountProfile } from "./features/account/WebAccountProfile";
import { OrdersView } from "./features/orders/OrdersView";
import { Home, ServiceDetail } from "./features/marketplace/MarketplaceViews";
import { ProviderDashboard } from "./features/provider/ProviderDashboard";
import { ProviderAccessGuide } from "./features/provider/ProviderAccessGuide";
import { AdminDashboard } from "./features/admin/AdminDashboard";
import { SchoolAdminDashboard } from "./features/admin/SchoolAdminDashboard";
import { api, backendConfigured } from "./lib/api";
import {
  applySchoolStatusUpdate,
  retainActiveSchoolSelection,
} from "./lib/school-state";
import type {
  AppNotification,
  AuthUser,
  Category,
  MarketplaceOrder,
  School,
  Service,
} from "./types";

type View =
  | "home"
  | "service"
  | "orders"
  | "provider"
  | "admin"
  | "school-admin"
  | "access";

export default function CampusGigApp() {
  const [view, setView] = useState<View>("home");
  const [selected, setSelected] = useState<Service | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>(defaultCategories);
  const [schools, setSchools] = useState<School[]>([]);
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [loading, setLoading] = useState(backendConfigured);
  const [webToken, setWebToken] = useState("");
  const [webUser, setWebUser] = useState<AuthUser | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(Date.now());
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [toast, setToast] = useState("");
  const [booked, setBooked] = useState(false);
  const [headerNotifications, setHeaderNotifications] = useState<
    AppNotification[]
  >([]);
  const [headerUnreadCount, setHeaderUnreadCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [readingAllNotifications, setReadingAllNotifications] = useState(false);
  const [incomingNotification, setIncomingNotification] =
    useState<AppNotification | null>(null);
  const [nightMode, setNightMode] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [pageScrolled, setPageScrolled] = useState(false);
  const [notificationOrderId, setNotificationOrderId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const enabled =
      window.localStorage.getItem("campusgig.nightMode") === "true";
    setNightMode(enabled);
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
  }, []);

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

  const refreshMarketplace = useCallback(async () => {
    const [serviceResult, categoryResult, schoolResult] =
      await Promise.allSettled([
        api.services(),
        api.categories(),
        api.schools(),
      ]);
    if (serviceResult.status === "fulfilled") setServices(serviceResult.value);
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
  }, []);

  useEffect(() => {
    if (!backendConfigured) return;
    void refreshMarketplace().finally(() => setLoading(false));
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

  async function refreshClientOrders() {
    if (!webToken) {
      setOrders([]);
      return;
    }
    setOrdersLoading(true);
    try {
      setOrders(await api.clientOrders(webToken));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load orders");
    } finally {
      setOrdersLoading(false);
    }
  }

  useEffect(() => {
    void refreshClientOrders();
  }, [webToken]);

  useEffect(() => {
    const token =
      window.localStorage.getItem("campusgig.webToken") ??
      window.localStorage.getItem("campusgig.adminToken") ??
      window.localStorage.getItem("campusgig.providerToken");
    if (!token) return;
    api
      .me(token)
      .then((user) => {
        window.localStorage.setItem("campusgig.webToken", token);
        window.localStorage.removeItem("campusgig.adminToken");
        window.localStorage.removeItem("campusgig.providerToken");
        setWebToken(token);
        setWebUser(user);
      })
      .catch(() => {
        window.localStorage.removeItem("campusgig.webToken");
        window.localStorage.removeItem("campusgig.adminToken");
        window.localStorage.removeItem("campusgig.providerToken");
      });
  }, []);

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
    return () => {
      window.clearInterval(timer);
      if (dismissTimer) window.clearTimeout(dismissTimer);
    };
  }, [webToken]);

  function routeAccount(user: AuthUser) {
    if (user.roles.includes("ADMIN")) navigate("admin");
    else if (user.roles.includes("SCHOOL_ADMIN")) navigate("school-admin");
    else if (user.roles.includes("PROVIDER")) navigate("provider");
    else navigate("access");
  }

  function setWebSession(token: string, user: AuthUser) {
    window.localStorage.setItem("campusgig.webToken", token);
    setWebToken(token);
    setWebUser(user);
    routeAccount(user);
  }

  function clearWebSession() {
    window.localStorage.removeItem("campusgig.webToken");
    setWebToken("");
    setWebUser(null);
    setHeaderNotifications([]);
    setHeaderUnreadCount(0);
    setNotificationsOpen(false);
    navigate("access");
    notify("Signed out");
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
    if (!window.confirm(`Mark all ${headerUnreadCount} unread notification${headerUnreadCount === 1 ? "" : "s"} as read?`)) return;
    setReadingAllNotifications(true);
    try {
      const result = await api.markAllNotificationsRead(webToken);
      const readAt = new Date().toISOString();
      setHeaderNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
      setHeaderUnreadCount(0);
      setIncomingNotification(null);
      notify(result.message);
    } catch {
      notify("Unable to mark notifications as read");
    } finally {
      setReadingAllNotifications(false);
    }
  }

  const filtered = useMemo(
    () =>
      services.filter((service) => {
        const matchesQuery =
          `${service.title} ${service.provider} ${service.category}`
            .toLowerCase()
            .includes(query.toLowerCase());
        const matchesCategory =
          activeCategory === "All" || service.category === activeCategory;
        const matchesSchool =
          !selectedSchoolId || service.schoolId === selectedSchoolId;
        return matchesQuery && matchesCategory && matchesSchool;
      }),
    [services, query, activeCategory, selectedSchoolId],
  );

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openService(service: Service) {
    setSelected(service);
    setBooked(false);
    navigate("service");
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  return (
    <div className="app-shell">
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
            <div className="notification-menu">
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
                        <button disabled={readingAllNotifications} onClick={() => void readAllNotifications()}>
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
                  <img src={api.avatarUrl(webUser.id, avatarVersion)} alt="" />
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
            filtered={filtered}
            loading={loading}
            openService={openService}
          />
        )}
        {view === "service" && selected && (
          <ServiceDetail
            service={selected}
            booked={booked}
            onBook={() => setBooked(true)}
            back={() => navigate("home")}
          />
        )}
        {view === "orders" &&
          (webToken && webUser ? (
            <OrdersView
              token={webToken}
              orders={orders}
              loading={ordersLoading}
              refresh={refreshClientOrders}
              openOrderId={notificationOrderId}
              onOrderOpened={() => setNotificationOrderId(null)}
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
              onOrderOpened={() => setNotificationOrderId(null)}
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
              user={webUser}
              notify={notify}
              onSchoolStatusChanged={handleSchoolStatusChanged}
              onLogout={clearWebSession}
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
    </div>
  );
}
