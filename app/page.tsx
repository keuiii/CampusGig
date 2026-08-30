"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { defaultCategories } from "./catalog";
import { api, backendConfigured } from "./lib/api";
import type { AppNotification, AuthUser, Category, DashboardStats, MarketplaceOrder, ModerationService, Order, OrderMessage, OrderWorkspace, ProviderProfile, ProviderService, ProviderStats, School, SchoolAdministrator, Service, Verification } from "./types";

type View = "home" | "service" | "orders" | "provider" | "admin" | "school-admin" | "access";

function Logo({ onClick }: { onClick?: () => void }) {
  return <button className="logo" onClick={onClick ?? (() => location.reload())}><span className="logo-mark">C</span><span>Campus<span>Gig</span></span></button>;
}

function Icon({ name }: { name: "search" | "bell" | "arrow" | "check" | "clock" }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function CampusGigApp() {
  const [view, setView] = useState<View>("home");
  const [selected, setSelected] = useState<Service | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>(defaultCategories);
  const [schools, setSchools] = useState<School[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(backendConfigured);
  const [webToken, setWebToken] = useState("");
  const [webUser, setWebUser] = useState<AuthUser | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(Date.now());
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [toast, setToast] = useState("");
  const [booked, setBooked] = useState(false);
  const [headerNotifications, setHeaderNotifications] = useState<AppNotification[]>([]);
  const [headerUnreadCount, setHeaderUnreadCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [incomingNotification, setIncomingNotification] = useState<AppNotification | null>(null);
  const [nightMode, setNightMode] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [pageScrolled, setPageScrolled] = useState(false);
  const [notificationOrderId, setNotificationOrderId] = useState<string | null>(null);

  useEffect(() => {
    const enabled = window.localStorage.getItem("campusgig.nightMode") === "true";
    setNightMode(enabled);
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
  }, []);

  useEffect(() => {
    let frame = 0;
    const updateScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const maximum = document.documentElement.scrollHeight - window.innerHeight;
        setScrollProgress(maximum > 0 ? Math.min(100,(window.scrollY / maximum) * 100) : 0);
        setPageScrolled(window.scrollY > 18);
      });
    };
    updateScroll();
    window.addEventListener("scroll",updateScroll,{passive:true});
    window.addEventListener("resize",updateScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll",updateScroll); window.removeEventListener("resize",updateScroll); };
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const selector = "section, footer, .service-card, .category-card, .panel, .stat-card, .access-card, .provider-request, .table-card, .how-step";
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("motion-visible"); observer.unobserve(entry.target); }
    }),{threshold:.08,rootMargin:"0px 0px -35px"});
    const observeNewElements = () => document.querySelectorAll(selector).forEach((element) => {
      if (!element.classList.contains("motion-reveal")) { element.classList.add("motion-reveal"); observer.observe(element); }
    });
    observeNewElements();
    document.documentElement.classList.add("motion-ready");
    const mutations = new MutationObserver(observeNewElements);
    mutations.observe(document.body,{childList:true,subtree:true});
    return () => { mutations.disconnect(); observer.disconnect(); document.documentElement.classList.remove("motion-ready"); };
  }, []);

  function toggleNightMode() {
    const enabled = !nightMode;
    setNightMode(enabled);
    window.localStorage.setItem("campusgig.nightMode", String(enabled));
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
  }

  useEffect(() => {
    if (!backendConfigured) return;
    Promise.allSettled([api.services(), api.categories(), api.schools(), api.orders()])
      .then(([serviceResult, categoryResult, schoolResult, orderResult]) => {
        if (serviceResult.status === "fulfilled") setServices(serviceResult.value);
        if (categoryResult.status === "fulfilled" && categoryResult.value.length > 0) setCategories(categoryResult.value);
        if (schoolResult.status === "fulfilled") setSchools(schoolResult.value);
        if (orderResult.status === "fulfilled") setOrders(orderResult.value);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const token = window.localStorage.getItem("campusgig.webToken") ?? window.localStorage.getItem("campusgig.adminToken") ?? window.localStorage.getItem("campusgig.providerToken");
    if (!token) return;
    api.me(token).then((user) => {
      window.localStorage.setItem("campusgig.webToken", token);
      window.localStorage.removeItem("campusgig.adminToken"); window.localStorage.removeItem("campusgig.providerToken");
      setWebToken(token); setWebUser(user);
    }).catch(() => { window.localStorage.removeItem("campusgig.webToken"); window.localStorage.removeItem("campusgig.adminToken"); window.localStorage.removeItem("campusgig.providerToken"); });
  }, []);

  useEffect(() => {
    if (!webToken) return;
    let initialized=false;
    let knownIds=new Set<string>();
    let dismissTimer:number|undefined;
    const refreshNotifications=()=>api.notifications(webToken).then((result) => {
      if(initialized){
        const incoming=result.data.find((item)=>!item.readAt&&!knownIds.has(item.id));
        if(incoming){setIncomingNotification(incoming);if(dismissTimer)window.clearTimeout(dismissTimer);dismissTimer=window.setTimeout(()=>setIncomingNotification(null),6500);}
      }
      knownIds=new Set(result.data.map((item)=>item.id));initialized=true;
      setHeaderNotifications(result.data);setHeaderUnreadCount(result.unreadCount);
    }).catch(() => undefined);
    void refreshNotifications();
    const timer=window.setInterval(()=>void refreshNotifications(),5000);
    return()=>{window.clearInterval(timer);if(dismissTimer)window.clearTimeout(dismissTimer);};
  }, [webToken]);

  function routeAccount(user: AuthUser) {
    if (user.roles.includes("ADMIN")) navigate("admin");
    else if (user.roles.includes("SCHOOL_ADMIN")) navigate("school-admin");
    else if (user.roles.includes("PROVIDER")) navigate("provider");
    else navigate("access");
  }

  function setWebSession(token: string, user: AuthUser) {
    window.localStorage.setItem("campusgig.webToken", token);
    setWebToken(token); setWebUser(user); routeAccount(user);
  }

  function clearWebSession() {
    window.localStorage.removeItem("campusgig.webToken");
    setWebToken(""); setWebUser(null); setHeaderNotifications([]); setHeaderUnreadCount(0); setNotificationsOpen(false); navigate("access"); notify("Signed out");
  }

  async function toggleNotifications() {
    if (!webToken) return navigate("access");
    if (notificationsOpen) return setNotificationsOpen(false);
    try { const result = await api.notifications(webToken); setHeaderNotifications(result.data); setHeaderUnreadCount(result.unreadCount); setNotificationsOpen(true); }
    catch { notify("Unable to load notifications"); }
  }

  async function readHeaderNotification(item: AppNotification) {
    if (!item.readAt) { await api.markNotificationRead(webToken, item.id); setHeaderNotifications((items) => items.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)); setHeaderUnreadCount((count) => Math.max(0, count - 1)); }
    setNotificationsOpen(false);
    setIncomingNotification(null);
    if (item.orderId) {
      if (webUser?.roles.includes("PROVIDER")) { setNotificationOrderId(item.orderId); navigate("provider"); }
      else navigate("orders");
    }
  }

  const filtered = useMemo(() => services.filter((service) => {
    const matchesQuery = `${service.title} ${service.provider} ${service.category}`.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = activeCategory === "All" || service.category === activeCategory;
    const matchesSchool = !selectedSchoolId || service.schoolId === selectedSchoolId;
    return matchesQuery && matchesCategory && matchesSchool;
  }), [services, query, activeCategory, selectedSchoolId]);

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
      <div className="scroll-progress" aria-hidden="true"><span style={{width:`${scrollProgress}%`}}/></div>
      <header className={`topbar ${pageScrolled ? "scrolled" : ""}`}>
        <div className="nav-wrap">
          <Logo onClick={() => navigate("home")}/>
          <nav>
            <button className={view === "home" ? "active" : ""} onClick={() => navigate("home")}>Discover</button>
            <button className={view === "orders" ? "active" : ""} onClick={() => navigate("orders")}>My orders</button>
            <button className={view === "provider" ? "active" : ""} onClick={() => navigate("provider")}>For providers</button>
          </nav>
          <div className="nav-actions">
            <button className={`web-theme-toggle ${nightMode ? "dark" : ""}`} role="switch" aria-checked={nightMode} aria-label="Toggle night mode" onClick={toggleNightMode}><span className="theme-sun">☀</span><span className="theme-moon">☾</span><i>{nightMode?"☾":"☀"}</i></button>
            <div className="notification-menu"><button className="icon-button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => void toggleNotifications()}><Icon name="bell"/>{headerUnreadCount>0&&<span className="notification-count">{headerUnreadCount>9?"9+":headerUnreadCount}</span>}</button>{notificationsOpen&&<div className="notification-dropdown"><div className="notification-dropdown-head"><div><span className="kicker">NOTIFICATIONS</span><b>Account activity</b></div><small>{headerUnreadCount} unread</small></div>{headerNotifications.length ? headerNotifications.slice(0,8).map((item) => <button key={item.id} className={item.readAt ? "read" : "unread"} onClick={() => void readHeaderNotification(item)}><span>{item.type === "NEW_MESSAGE" ? "✉" : item.type === "NEW_ORDER" ? "↗" : item.type === "ORDER_ACCEPTED" ? "✓" : "!"}</span><div><b>{item.title}</b><small>{item.body}</small><time>{new Date(item.createdAt).toLocaleString()}</time></div>{!item.readAt&&<i/>}</button>) : <div className="notification-empty"><span>♧</span><b>No notifications yet</b><small>New order activity will appear here.</small></div>}</div>}</div>
            <button className="profile-chip" onClick={() => navigate("access")}><span className="avatar small">{webUser?.hasAvatar ? <img src={api.avatarUrl(webUser.id, avatarVersion)} alt=""/> : webUser ? webUser.displayName.slice(0, 2).toUpperCase() : "?"}</span><span>{webUser?.displayName ?? "Account"}</span></button>
          </div>
        </div>
      </header>

      <div key={view} className="view-transition">
        {view === "home" && <Home query={query} setQuery={setQuery} activeCategory={activeCategory} setActiveCategory={setActiveCategory} categories={categories} schools={schools} selectedSchoolId={selectedSchoolId} setSelectedSchoolId={setSelectedSchoolId} filtered={filtered} loading={loading} openService={openService} />}
        {view === "service" && selected && <ServiceDetail service={selected} booked={booked} onBook={() => setBooked(true)} back={() => navigate("home")} />}
        {view === "orders" && <OrdersView orders={orders} notify={notify} />}
        {view === "provider" && (webToken && webUser?.roles.includes("PROVIDER") ? <ProviderDashboard token={webToken} user={webUser} categories={categories} notify={notify} onLogout={clearWebSession} openOrderId={notificationOrderId} onOrderOpened={()=>setNotificationOrderId(null)}/> : <UnifiedAccount onAuthenticated={setWebSession}/>) }
        {view === "admin" && (webToken && webUser?.roles.includes("ADMIN") ? <AdminDashboard token={webToken} user={webUser} notify={notify} onLogout={clearWebSession}/> : <UnifiedAccount onAuthenticated={setWebSession}/>) }
        {view === "school-admin" && (webToken && webUser?.roles.includes("SCHOOL_ADMIN") ? <SchoolAdminDashboard token={webToken} user={webUser} notify={notify} onLogout={clearWebSession}/> : <UnifiedAccount onAuthenticated={setWebSession}/>) }
        {view === "access" && (webUser ? <WebAccountProfile token={webToken} user={webUser} avatarVersion={avatarVersion} notify={notify} onAvatarChanged={() => { setWebUser((current) => current ? { ...current, hasAvatar: true } : current); setAvatarVersion(Date.now()); }} onOpenWorkspace={() => routeAccount(webUser)} onLogout={clearWebSession}/> : <UnifiedAccount onAuthenticated={setWebSession}/>)}
      </div>

      {toast && <div className="toast"><span className="toast-check"><Icon name="check" /></span>{toast}</div>}
      {incomingNotification&&<button className="incoming-notification" onClick={()=>void readHeaderNotification(incomingNotification)}><span>✉</span><div><small>NEW MESSAGE</small><b>{incomingNotification.title}</b><p>{incomingNotification.body}</p></div><i>Open →</i></button>}
    </div>
  );
}

function Home({ query, setQuery, activeCategory, setActiveCategory, categories, schools, selectedSchoolId, setSelectedSchoolId, filtered, loading, openService }: {
  query: string; setQuery: (v: string) => void; activeCategory: string; setActiveCategory: (v: string) => void; categories: Category[]; schools: School[]; selectedSchoolId: string; setSelectedSchoolId: (v: string) => void; filtered: Service[]; loading: boolean; openService: (s: Service) => void;
}) {
  function submit(e: FormEvent) { e.preventDefault(); }
  return <>
    <main>
      <section className="hero">
        <div className="hero-orb one"/><div className="hero-orb two"/>
        <div className="hero-copy">
          <span className="eyebrow">BUILT BY STUDENTS, FOR STUDENTS</span>
          <h1>Turn student skills into<br/><em>real opportunities.</em></h1>
          <p>Discover trusted, affordable services from verified students across participating schools in Lipa City.</p>
          <form className="search-box" onSubmit={submit}>
            <Icon name="search" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What service are you looking for?" />
            <button>Search</button>
          </form>
          <label className="school-filter"><span>Preferred school</span><select value={selectedSchoolId} onChange={(e) => setSelectedSchoolId(e.target.value)}><option value="">All participating schools</option>{schools.map((school) => <option value={school.id} key={school.id}>{school.shortName || school.name}</option>)}</select></label>
          <div className="trust-row"><span><b>✓</b> Verified students</span><span><b>✓</b> School-based trust</span><span><b>✓</b> Secure order tracking</span></div>
        </div>
        <div className="hero-art">
          <div className="floating-card fc-one"><span className="mini-icon purple">✦</span><div><b>Student Services</b><small>Verified campus talent</small></div></div>
          <div className="student-portrait"><span className="portrait-hair"/><span className="portrait-face">◡</span><span className="portrait-body"/></div>
          <div className="floating-card fc-two"><span className="avatar">CG</span><div><b>Verified Provider <i>✓</i></b><small>Student-led services</small></div></div>
          <div className="spark s1">✦</div><div className="spark s2">✧</div><div className="spark s3">✦</div>
        </div>
      </section>

      <section className="section categories-section">
        <div className="section-heading"><div><span className="kicker">EXPLORE BY CATEGORY</span><h2>Whatever you need, a student can help.</h2></div><button className="text-link" onClick={() => setActiveCategory("All")}>View all <Icon name="arrow"/></button></div>
        <div className="category-grid">
          {categories.map((category) => <button key={category.name} className={`category-card ${activeCategory === category.name ? "selected" : ""}`} onClick={() => setActiveCategory(activeCategory === category.name ? "All" : category.name)}>
            <span className={`category-icon ${category.color ?? "mint"}`}>{category.icon ?? "◇"}</span><b>{category.name}</b><small>{category.serviceCount} services</small><span className="corner-arrow">↗</span>
          </button>)}
          {!loading && categories.length === 0 && <div className="empty"><span>◇</span><h3>No categories yet</h3><p>Categories will appear after they are created in the backend.</p></div>}
        </div>
      </section>

      <section className="section services-section" id="services-marketplace">
        <div className="section-heading"><div><span className="kicker">POPULAR RIGHT NOW</span><h2>{activeCategory === "All" ? "Services students love" : activeCategory}</h2></div><span className="result-count">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span></div>
        <div className="service-grid">
          {filtered.map((service) => <ServiceCard key={service.id} service={service} open={() => openService(service)} />)}
          {loading && <div className="empty"><span>◌</span><h3>Loading services</h3><p>Connecting to the CampusGig API.</p></div>}
          {!loading && filtered.length === 0 && <div className="empty"><span>⌕</span><h3>No services published yet</h3><p>Published provider services will appear here automatically.</p></div>}
        </div>
      </section>

      <section className="how-section">
        <div className="how-orb how-orb-one"/><div className="how-orb how-orb-two"/>
        <div className="section how-inner"><div className="how-heading"><span className="kicker light">HOW CAMPUSGIG WORKS</span><h2>A simple path from idea to <em>finished.</em></h2><p>CampusGig keeps discovery, collaboration, and delivery together so every student project stays clear and organized.</p></div><div className="steps">
          <article className="how-step"><div className="step-top"><span className="step-number">01</span><span className="step-icon">⌕</span></div><span className="step-label">EXPLORE</span><b>Discover campus talent</b><p>Browse verified student providers, compare packages, and filter services by your preferred school.</p><small>Find the right match <span>→</span></small></article>
          <article className="how-step featured"><div className="step-top"><span className="step-number">02</span><span className="step-icon">✦</span></div><span className="step-label">COLLABORATE</span><b>Book with confidence</b><p>Choose a package, share clear requirements, and follow every update through your CampusGig order.</p><small>Stay connected <span>→</span></small></article>
          <article className="how-step"><div className="step-top"><span className="step-number">03</span><span className="step-icon">✓</span></div><span className="step-label">COMPLETE</span><b>Receive and review</b><p>Review the final work, request revisions when needed, and recognize excellent student talent.</p><small>Support student skills <span>→</span></small></article>
        </div><button className="how-cta" onClick={()=>{setActiveCategory("All");document.getElementById("services-marketplace")?.scrollIntoView({behavior:"smooth"});}}>Explore student services <Icon name="arrow"/></button></div>
      </section>
    </main>
    <Footer />
  </>;
}

function ServiceCard({ service, open }: { service: Service; open: () => void }) {
  return <article className="service-card" onClick={open}>
    <div className={`service-cover ${service.color ?? "service-green"}`}>{service.coverMediaId ? <img src={api.serviceMediaUrl(service.id, service.coverMediaId)} alt={`${service.title} cover`}/> : <><span className="cover-grid"/><span className="cover-icon">{service.icon ?? "◇"}</span></>}<span className="category-pill">{service.category}</span><button className="heart" aria-label="Save service" onClick={(e) => e.stopPropagation()}>♡</button></div>
    <div className="service-body"><div className="provider-line"><span className="avatar">{service.providerHasAvatar ? <img src={api.avatarUrl(service.providerId,service.providerAvatarVersion)} alt={`${service.provider} profile`}/> : service.initials}</span><div><b>{service.provider} <i>✓</i></b><small>{service.school}</small></div></div><h3>{service.title}</h3><div className="rating"><span>★</span> <b>{service.rating}</b> <small>({service.reviews})</small></div><div className="card-footer"><small>STARTING AT</small><strong>₱{service.price}</strong></div></div>
  </article>;
}

function ServiceDetail({ service, booked, onBook, back }: { service: Service; booked: boolean; onBook: () => void; back: () => void }) {
  const [tier, setTier] = useState<"Basic" | "Standard" | "Premium">("Basic");
  const prices = { Basic: service.price, Standard: service.price * 2, Premium: service.price * 3 };
  if (booked) return <main className="success-page"><div className="success-mark"><Icon name="check" /></div><span className="kicker">BOOKING FLOW READY</span><h1>Connect order creation to continue.</h1><p>The interface has collected the selected service and package. The backend will assign the real order number and persist its lifecycle.</p><div className="success-order"><div><small>ORDER NUMBER</small><b>Assigned by API</b></div><div><small>SERVICE</small><b>{service.category}</b></div><div><small>TOTAL</small><b>₱{prices[tier]}</b></div></div><button className="primary-button" onClick={back}>Return to marketplace</button></main>;
  return <main className="detail-page">
    <button className="back-button" onClick={back}>← Back to services</button>
    <div className="detail-grid">
      <section><span className="detail-category">{service.category}</span><h1>{service.title}</h1><div className="detail-provider"><span className="avatar large">{service.providerHasAvatar ? <img src={api.avatarUrl(service.providerId,service.providerAvatarVersion)} alt={`${service.provider} profile`}/> : service.initials}</span><div><b>{service.provider} <i>✓</i></b><span>{service.program} · {service.school}</span><small><span className="star">★</span> {service.rating} ({service.reviews} reviews)</small></div></div><div className={`detail-cover ${service.color ?? "service-green"}`}>{service.coverMediaId ? <img src={api.serviceMediaUrl(service.id, service.coverMediaId)} alt={`${service.title} cover`}/> : <><span className="cover-grid"/><span>{service.icon ?? "◇"}</span></>}</div><div className="about"><h2>About this service</h2><p>{service.description}</p>{service.portfolio?.length ? <><h3>Portfolio</h3><div className="portfolio-links">{service.portfolio.map((item) => <a key={item.id} href={api.serviceMediaUrl(service.id, item.id)} target="_blank" rel="noreferrer">{item.originalName}</a>)}</div></> : null}<h3>What you&apos;ll get</h3><ul><li><Icon name="check"/>Original, student-focused work</li><li><Icon name="check"/>Editable source files</li><li><Icon name="check"/>Clear in-app communication</li><li><Icon name="check"/>Revisions included with your package</li></ul></div></section>
      <aside className="booking-card"><div className="tier-tabs">{(["Basic", "Standard", "Premium"] as const).map((item) => <button className={tier === item ? "active" : ""} onClick={() => setTier(item)} key={item}>{item}</button>)}</div><div className="package-title"><h3>{tier} package</h3><strong>₱{prices[tier]}</strong></div><p>{tier === "Basic" ? "A focused package for a simple student requirement." : tier === "Standard" ? "More coverage and revisions for larger projects." : "Complete support for your most important projects."}</p><div className="package-meta"><span><Icon name="clock"/> {tier === "Basic" ? service.delivery : tier === "Standard" ? "3 days" : "4 days"} delivery</span><span>↻ {tier === "Basic" ? 2 : tier === "Standard" ? 3 : 5} revisions</span></div><ul><li><Icon name="check"/>Requirements consultation</li><li><Icon name="check"/>Final high-quality output</li><li><Icon name="check"/>Source file included</li></ul><button className="primary-button wide" onClick={onBook}>Continue — ₱{prices[tier]} <Icon name="arrow"/></button><small className="safe-note">You won&apos;t be charged in this prototype.</small></aside>
    </div>
  </main>;
}

function OrdersView({ orders, notify }: { orders: Order[]; notify: (s: string) => void }) {
  const active = orders.filter((order) => order.status !== "Completed").length;
  const completed = orders.filter((order) => order.status === "Completed").length;
  return <main className="dashboard-page"><DashboardHeader kicker="MY PROJECTS" title="Orders" subtitle="Track your bookings and keep every project moving."/><div className="filter-tabs"><button className="active">All orders <span>{orders.length}</span></button><button>Active <span>{active}</span></button><button>Completed <span>{completed}</span></button></div><div className="table-card"><div className="table-head"><span>Order</span><span>Client</span><span>Amount</span><span>Due date</span><span>Status</span><span/></div>{orders.map((order) => <div className="table-row" key={order.id}><span><b>{order.service}</b><small>{order.id}</small></span><span>{order.client}</span><span><b>₱{order.amount}</b></span><span>{order.due}</span><span><Status label={order.status}/></span><span><button className="row-button" onClick={() => notify(`${order.id} opened`)}>View order →</button></span></div>)}{orders.length === 0 && <div className="empty compact"><span>◇</span><h3>No orders yet</h3><p>Bookings will appear here after the backend creates them.</p></div>}</div></main>;
}

function UnifiedAccount({ onAuthenticated }: { onAuthenticated: (token: string, user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "verify" | "forgot" | "reset">("login");
  const [displayName, setDisplayName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [code, setCode] = useState(""); const [isStudent, setIsStudent] = useState(false); const [showPassword, setShowPassword] = useState(false); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  function switchMode(next: "login" | "register" | "verify" | "forgot" | "reset") { if (next === mode) return; setMode(next); setError(""); setNotice(""); setPassword(""); setCode(""); setShowPassword(false); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSubmitting(true); setError("");
    try {
      if (mode === "login") { const session = await api.login(email.trim(), password); onAuthenticated(session.accessToken, session.user); }
      else if (mode === "register") { const result = await api.register(displayName.trim(), email.trim(), password, isStudent); setMode("verify"); setCode(result.developmentCode ?? ""); setNotice(result.developmentCode ? "Development mode: your test code is filled in below." : "Check your inbox for your six-digit verification code."); }
      else if (mode === "verify") { const session = await api.verifyEmail(email.trim(), code); onAuthenticated(session.accessToken, session.user); }
      else if (mode === "forgot") { const result = await api.forgotPassword(email.trim()); setMode("reset"); setCode(result.developmentCode ?? ""); setNotice(result.developmentCode ? "Development mode: your test reset code is filled in below." : result.message); }
      else { const result = await api.resetPassword(email.trim(), code, password); setNotice(result.message); setMode("login"); setCode(""); setPassword(""); }
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to continue."); } finally { setSubmitting(false); }
  }
  const title = mode === "login" ? "Welcome back" : mode === "register" ? "Create your account" : mode === "verify" ? "Verify your email" : mode === "forgot" ? "Forgot your password?" : "Create a new password";
  const description = mode === "verify" ? `Enter the code sent to ${email}.` : mode === "forgot" ? "Enter your account email and we’ll send a reset code." : mode === "reset" ? "Enter the six-digit code and your new password." : mode === "login" ? "CampusGig will automatically open the workspace allowed for your account." : "Create a Client account. Select Student only if you attend a participating school.";
  return <main className="admin-login-page"><section className="admin-login-card unified-auth-card"><div className="admin-login-mark">C</div><span className="kicker">ONE CAMPUSGIG ACCOUNT</span><div key={`intro-${mode}`} className="auth-copy-transition"><h1>{title}</h1><p>{description}</p></div>{(mode === "login" || mode === "register") && <div className={`web-auth-tabs ${mode}`}><span className="web-auth-slider"/><button type="button" className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Log in</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>Sign up</button></div>}<form key={mode} className="auth-form-transition" onSubmit={submit}>{mode === "register" && <label>Full name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={80} required autoComplete="name"/></label>}{mode !== "verify" && <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required autoComplete="email"/></label>}{mode === "register" && <label className="student-choice"><input type="checkbox" checked={isStudent} onChange={(event) => setIsStudent(event.target.checked)}/><span><b>I’m currently a student</b><small>Select this only if you attend a participating school and want school verification or future provider access.</small></span></label>}{(mode === "verify" || mode === "reset") && <label>Six-digit code<input className="verification-code-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code"/></label>}{(mode === "login" || mode === "register" || mode === "reset") && <label>{mode === "reset" ? "New password" : "Password"}<div className="web-password-field"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required autoComplete={mode === "login" ? "current-password" : "new-password"}/><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></div></label>}{(mode === "register" || mode === "reset") && <div className={`web-password-rule ${password.length >= 8 ? "ready" : ""}`}><span>{password.length >= 8 ? "✓" : "○"}</span> Minimum 8 characters</div>}{notice && <div className="auth-notice">{notice}</div>}{error && <div className="admin-login-error">{error}</div>}<button className="primary-button wide" disabled={submitting}>{submitting ? "Please wait…" : mode === "login" ? "Continue to CampusGig" : mode === "register" ? `Create ${isStudent ? "student" : "client"} account` : mode === "verify" ? "Verify and continue" : mode === "forgot" ? "Send reset code" : "Update password"}</button></form>{mode === "login" && <button className="auth-text-button" onClick={() => switchMode("forgot")}>Forgot password?</button>}{(mode === "forgot" || mode === "reset" || mode === "verify") && <button className="auth-text-button" onClick={() => switchMode("login")}>← Back to login</button>}<small>School-provided email is optional. Your account email is never shown publicly.</small></section></main>;
}

function WebAccountProfile({ token, user, avatarVersion, notify, onAvatarChanged, onOpenWorkspace, onLogout }: { token: string; user: AuthUser; avatarVersion: number; notify: (message: string) => void; onAvatarChanged: () => void; onOpenWorkspace: () => void; onLogout: () => void }) {
  const isStudent = user.roles.includes("STUDENT");
  const hasWorkspace = user.roles.some((role) => ["PROVIDER", "SCHOOL_ADMIN", "ADMIN"].includes(role));
  const [uploading, setUploading] = useState(false);
  async function selectAvatar(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) return notify("Choose a JPG or PNG profile picture");
    if (file.size > 5 * 1024 * 1024) return notify("Profile picture must be 5 MB or smaller");
    setUploading(true);
    try { await api.uploadAvatar(token, file); onAvatarChanged(); notify("Profile picture updated"); }
    catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to upload profile picture"); }
    finally { setUploading(false); }
  }
  const accountLabel = user.roles.includes("ADMIN") ? "PLATFORM ADMINISTRATOR" : user.roles.includes("SCHOOL_ADMIN") ? "SCHOOL ADMINISTRATOR" : user.roles.includes("PROVIDER") ? "STUDENT PROVIDER" : isStudent ? "STUDENT CLIENT ACCOUNT" : "CLIENT ACCOUNT";
  return <main className="access-page"><section className="student-web-card"><label className={`web-avatar-editor ${uploading ? "uploading" : ""}`} title="Change profile picture"><span className="avatar web-profile-avatar">{uploading ? "…" : user.hasAvatar ? <img src={api.avatarUrl(user.id, avatarVersion)} alt={`${user.displayName} profile`}/> : user.displayName.slice(0, 2).toUpperCase()}</span><span className="web-avatar-badge">＋</span><input type="file" accept="image/jpeg,image/png" disabled={uploading} onChange={(event) => { void selectAvatar(event.target.files?.[0]); event.target.value = ""; }}/></label><small className="avatar-instruction">Click your photo to upload a JPG or PNG up to 5 MB</small><span className="kicker">{accountLabel}</span><h1>Welcome, {user.displayName}</h1><p>Your profile picture is shared across the CampusGig web and mobile apps. Your account can keep multiple roles without creating separate logins.</p><div className="student-session"><div><small>ACCOUNT</small><b>{user.email}</b></div><div><small>ACCESS</small><b>{user.roles.join(" · ")}</b></div></div><div className="web-account-actions">{hasWorkspace&&<button className="primary-button" onClick={onOpenWorkspace}>Open my workspace</button>}<button className="outline-action" onClick={onLogout}>Sign out</button></div></section></main>;
}

function ProviderDashboard({ token, user, categories, notify, onLogout, openOrderId, onOrderOpened }: { token: string; user: AuthUser; categories: Category[]; notify: (s: string) => void; onLogout: () => void; openOrderId?: string | null; onOrderOpened?: () => void }) {
  type PackageDraft = { tier: "BASIC" | "STANDARD" | "PREMIUM"; enabled: boolean; name: string; description: string; pricePesos: string; deliveryDays: string; revisionLimit: string };
  const blankPackages = (): PackageDraft[] => [
    { tier: "BASIC", enabled: true, name: "Basic package", description: "", pricePesos: "", deliveryDays: "3", revisionLimit: "1" },
    { tier: "STANDARD", enabled: false, name: "Standard package", description: "", pricePesos: "", deliveryDays: "5", revisionLimit: "2" },
    { tier: "PREMIUM", enabled: false, name: "Premium package", description: "", pricePesos: "", deliveryDays: "7", revisionLimit: "3" },
  ];
  const [stats, setStats] = useState<ProviderStats>({ activeOrders: 0, pendingRequests: 0, completedOrders: 0, averageRating: 0, reviewCount: 0, profileStrength: 0 });
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [providerOrders, setProviderOrders] = useState<MarketplaceOrder[]>([]);
  const [workspaceOrder, setWorkspaceOrder] = useState<MarketplaceOrder | null>(null);
  const [profileForm, setProfileForm] = useState({ headline: "", bio: "", skills: "", isAvailable: true });
  const [serviceForm, setServiceForm] = useState({ categoryId: categories[0]?.id ?? "", title: "", description: "", deliveryMethod: "ONLINE", campusLocation: "", packages: blankPackages() });
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [mediaDrafts, setMediaDrafts] = useState<Record<string, { cover: File | null; portfolio: File[] }>>({});
  const [uploadingMediaId, setUploadingMediaId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false); const [savingService, setSavingService] = useState(false);

  async function refresh() {
    try {
      const [nextStats, profileResult, nextServices, nextOrders] = await Promise.all([api.providerStats(token), api.providerProfile(token), api.providerServices(token), api.providerOrders(token)]);
      setStats(nextStats); setProfile(profileResult.data); setServices(nextServices); setProviderOrders(nextOrders);
      if (profileResult.data) setProfileForm({ headline: profileResult.data.headline, bio: profileResult.data.bio, skills: profileResult.data.skills.join(", "), isAvailable: profileResult.data.isAvailable });
    } catch { notify("Unable to load provider workspace"); }
  }
  useEffect(() => { void refresh(); }, [token]);
  useEffect(() => { if (!openOrderId || !providerOrders.length) return; const target = providerOrders.find((order) => order.id === openOrderId); if (target) { setWorkspaceOrder(target); onOrderOpened?.(); } }, [openOrderId, providerOrders]);
  useEffect(() => { if (!serviceForm.categoryId && categories[0]) setServiceForm((value) => ({ ...value, categoryId: categories[0].id })); }, [categories, serviceForm.categoryId]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setSavingProfile(true);
    try { const result = await api.updateProviderProfile(token, { headline: profileForm.headline, bio: profileForm.bio, skills: profileForm.skills.split(",").map((skill) => skill.trim()).filter(Boolean), isAvailable: profileForm.isAvailable }); setProfile(result.data); notify("Provider profile saved"); await refresh(); }
    catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to save provider profile"); } finally { setSavingProfile(false); }
  }
  function servicePayload() {
    return { categoryId: serviceForm.categoryId, title: serviceForm.title, description: serviceForm.description, deliveryMethod: serviceForm.deliveryMethod, campusLocation: serviceForm.campusLocation || undefined, packages: serviceForm.packages.filter((item) => item.enabled).map((item) => ({ tier: item.tier, name: item.name, description: item.description, priceCentavos: Math.round(Number(item.pricePesos) * 100), deliveryDays: Number(item.deliveryDays), revisionLimit: Number(item.revisionLimit) })) };
  }
  function resetServiceForm() { setEditingServiceId(null); setServiceForm({ categoryId: categories[0]?.id ?? "", title: "", description: "", deliveryMethod: "ONLINE", campusLocation: "", packages: blankPackages() }); }
  function updatePackage(tier: PackageDraft["tier"], changes: Partial<PackageDraft>) { setServiceForm((value) => ({ ...value, packages: value.packages.map((item) => item.tier === tier ? { ...item, ...changes } : item) })); }
  function editService(service: ProviderService) {
    const packages = blankPackages().map((draft) => { const saved = service.packages.find((item) => item.tier === draft.tier); return saved ? { tier: draft.tier, enabled: true, name: saved.name, description: saved.description, pricePesos: String(saved.priceCentavos / 100), deliveryDays: String(saved.deliveryDays), revisionLimit: String(saved.revisionLimit) } : draft; });
    setEditingServiceId(service.id); setServiceForm({ categoryId: service.category.id, title: service.title, description: service.description, deliveryMethod: service.deliveryMethod, campusLocation: service.campusLocation ?? "", packages }); window.scrollTo({ top: 430, behavior: "smooth" });
  }
  async function saveService(event: FormEvent) {
    event.preventDefault(); setSavingService(true);
    try {
      const result = editingServiceId ? await api.updateProviderService(token, editingServiceId, servicePayload()) : await api.createProviderService(token, servicePayload());
      setServices((items) => editingServiceId ? items.map((item) => item.id === editingServiceId ? result.data : item) : [result.data, ...items]); notify(editingServiceId ? "Service draft updated" : "Service draft created"); resetServiceForm();
    } catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to save service"); } finally { setSavingService(false); }
  }
  async function submitService(service: ProviderService) {
    try { const result = await api.submitProviderService(token, service.id); setServices((items) => items.map((item) => item.id === service.id ? { ...item, status: result.data.status } : item)); notify("Service submitted for administrator review"); }
    catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to submit service"); }
  }
  async function uploadMedia(service: ProviderService) {
    const selected = mediaDrafts[service.id]; if (!selected?.cover && !selected?.portfolio.length) return notify("Choose a cover or portfolio file first");
    setUploadingMediaId(service.id);
    try { const result = await api.uploadProviderMedia(token, service.id, selected.cover, selected.portfolio); setServices((items) => items.map((item) => item.id === service.id ? { ...item, media: result.data } : item)); setMediaDrafts((value) => ({ ...value, [service.id]: { cover: null, portfolio: [] } })); notify("Service media uploaded privately"); }
    catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to upload service media"); } finally { setUploadingMediaId(null); }
  }
  async function removeMedia(service: ProviderService, mediaId: string) {
    try { await api.removeProviderMedia(token, service.id, mediaId); setServices((items) => items.map((item) => item.id === service.id ? { ...item, media: item.media.filter((media) => media.id !== mediaId) } : item)); notify("Service media removed"); }
    catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to remove service media"); }
  }
  async function decideOrder(order: MarketplaceOrder, decision: "accept" | "reject") {
    const reason = decision === "reject" ? window.prompt("Tell the client why you cannot accept this request:")?.trim() : "";
    if (decision === "reject" && (!reason || reason.length < 3)) return;
    try {
      const result = decision === "accept" ? await api.acceptOrder(token, order.id) : await api.rejectOrder(token, order.id, reason!);
      setProviderOrders((items) => items.map((item) => item.id === order.id ? result.data : item)); notify(result.message); await refresh();
    } catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to update the request"); }
  }
  async function startOrder(order: MarketplaceOrder) {
    try {
      const result = await api.startOrder(token, order.id);
      setProviderOrders((items) => items.map((item) => item.id === order.id ? result.data : item)); notify(result.message); await refresh();
    } catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to start the order"); }
  }

  return <main className="dashboard-page">
    <DashboardHeader kicker="PROVIDER WORKSPACE" title="Provider dashboard" subtitle={`Verified account · ${user.displayName}`} action={<button className="outline-action" onClick={onLogout}>Sign out</button>}/>
    <div className="stats-grid"><Stat label="Active orders" value={String(stats.activeOrders)} change="Current work" icon="↗"/><Stat label="Pending requests" value={String(stats.pendingRequests)} change="Awaiting response" icon="◷"/><Stat label="Completed orders" value={String(stats.completedOrders)} change="Finished projects" icon="✓"/><Stat label="Average rating" value={stats.averageRating.toFixed(1)} change={`From ${stats.reviewCount} reviews`} icon="★"/></div>
    <section className="panel provider-requests"><div className="panel-title"><div><span className="kicker">ORDER REQUESTS</span><h2>Client service requests</h2></div><span className="queue-count">{providerOrders.filter((order) => order.status === "REQUESTED").length} awaiting decision</span></div>{providerOrders.length ? providerOrders.map((order) => <article className="provider-request" key={order.id}><div className="request-main"><span className={`listing-status ${order.status.toLowerCase()}`}>{order.status.replaceAll("_"," ")}</span><small>{order.orderNumber}</small><h3>{order.title}</h3><p>{order.requirements}</p><div className="request-facts"><span><small>CLIENT</small><b>{order.client.displayName}</b></span><span><small>PACKAGE</small><b>{order.package.name}</b></span><span><small>TOTAL</small><b>₱{(order.totalCentavos/100).toLocaleString()}</b></span><span><small>DUE</small><b>{new Date(order.dueAt).toLocaleDateString()}</b></span></div></div>{order.status === "REQUESTED" ? <div className="request-actions"><button className="approve" onClick={() => void decideOrder(order,"accept")}>Accept request</button><button className="reject" onClick={() => void decideOrder(order,"reject")}>Reject</button><button className="outline-button" onClick={()=>setWorkspaceOrder(order)}>Open workspace</button></div> : order.status === "ACCEPTED" ? <div className="request-actions"><button className="approve" onClick={() => void startOrder(order)}>Start working</button><button className="outline-button" onClick={()=>setWorkspaceOrder(order)}>Open workspace</button></div> : <div className="request-actions"><span className="request-decision">{order.status === "IN_PROGRESS" ? "Work in progress · Client notified" : "Decision recorded · Client notified"}</span><button className="outline-button" onClick={()=>setWorkspaceOrder(order)}>Open workspace</button></div>}</article>) : <div className="empty compact"><span>◇</span><h3>No service requests yet</h3><p>New client bookings will appear here for your decision.</p></div>}</section>
    <div className="provider-setup-grid"><section className="panel"><span className="kicker">PROVIDER IDENTITY</span><h2>{profile ? "Update your provider profile" : "Create your provider profile"}</h2><form className="provider-form" onSubmit={saveProfile}><label>Professional headline<input value={profileForm.headline} onChange={(event) => setProfileForm({ ...profileForm, headline: event.target.value })} minLength={3} maxLength={100} placeholder="Student graphic designer and illustrator" required/></label><label>Provider bio<textarea value={profileForm.bio} onChange={(event) => setProfileForm({ ...profileForm, bio: event.target.value })} minLength={20} maxLength={1000} placeholder="Describe your experience and the value you provide." required/></label><label>Skills <small>Separate with commas</small><input value={profileForm.skills} onChange={(event) => setProfileForm({ ...profileForm, skills: event.target.value })} placeholder="Logo design, Canva, Illustration" required/></label><label className="availability-check"><input type="checkbox" checked={profileForm.isAvailable} onChange={(event) => setProfileForm({ ...profileForm, isAvailable: event.target.checked })}/> Available for new orders</label><button className="primary-button" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save provider profile"}</button></form></section>
    <section className="panel"><span className="kicker">{editingServiceId ? "EDIT LISTING" : "NEW LISTING"}</span><h2>{editingServiceId ? "Update service draft" : "Create a service draft"}</h2>{!profile ? <div className="provider-gate">Complete your provider profile before creating a listing.</div> : <form className="provider-form" onSubmit={saveService}><label>Category<select value={serviceForm.categoryId} onChange={(event) => setServiceForm({ ...serviceForm, categoryId: event.target.value })} required>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label>Service title<input value={serviceForm.title} onChange={(event) => setServiceForm({ ...serviceForm, title: event.target.value })} minLength={10} maxLength={120} required/></label><label>Description<textarea value={serviceForm.description} onChange={(event) => setServiceForm({ ...serviceForm, description: event.target.value })} minLength={50} maxLength={3000} required/></label><div className="provider-form-row"><label>Delivery<select value={serviceForm.deliveryMethod} onChange={(event) => setServiceForm({ ...serviceForm, deliveryMethod: event.target.value })}><option value="ONLINE">Online</option><option value="IN_PERSON">In person</option><option value="HYBRID">Hybrid</option></select></label><label>Campus location <small>Optional</small><input value={serviceForm.campusLocation} onChange={(event) => setServiceForm({ ...serviceForm, campusLocation: event.target.value })}/></label></div><div className="package-stack">{serviceForm.packages.map((item) => <div className={`package-editor ${item.enabled ? "" : "disabled"}`} key={item.tier}><label className="package-toggle"><input type="checkbox" checked={item.enabled} disabled={item.tier === "BASIC"} onChange={(event) => updatePackage(item.tier, { enabled: event.target.checked })}/><b>{item.tier[0] + item.tier.slice(1).toLowerCase()} package</b>{item.tier === "BASIC" ? <small>Required</small> : <small>Optional</small>}</label>{item.enabled && <><label>Package name<input value={item.name} onChange={(event) => updatePackage(item.tier, { name: event.target.value })} required/></label><label>What is included?<textarea value={item.description} onChange={(event) => updatePackage(item.tier, { description: event.target.value })} minLength={10} required/></label><div className="provider-form-row three"><label>Price (₱)<input type="number" min="1" step="1" value={item.pricePesos} onChange={(event) => updatePackage(item.tier, { pricePesos: event.target.value })} required/></label><label>Delivery days<input type="number" min="1" max="90" value={item.deliveryDays} onChange={(event) => updatePackage(item.tier, { deliveryDays: event.target.value })} required/></label><label>Revisions<input type="number" min="0" max="20" value={item.revisionLimit} onChange={(event) => updatePackage(item.tier, { revisionLimit: event.target.value })} required/></label></div></>}</div>)}</div><div className="service-form-actions"><button className="primary-button" disabled={savingService}>{savingService ? "Saving…" : editingServiceId ? "Save changes" : "Create draft"}</button>{editingServiceId && <button type="button" className="outline-button" onClick={resetServiceForm}>Cancel editing</button>}</div></form>}</section></div>
    <section className="panel provider-services-panel"><div className="panel-title"><div><span className="kicker">YOUR SERVICES</span><h2>Listings, packages, and media</h2></div><span className="queue-count">{services.length} service{services.length === 1 ? "" : "s"}</span></div>{services.length ? services.map((service) => <div className="service-listing-block" key={service.id}><div className="provider-service-row"><div><b>{service.title}</b><small>{service.category.name} · {service.packages.length} package{service.packages.length === 1 ? "" : "s"} · {service.media?.length ?? 0} media file{service.media?.length === 1 ? "" : "s"}</small>{service.status === "REJECTED" && service.rejectionReason ? <small className="rejection-copy">Admin feedback: {service.rejectionReason}</small> : null}</div><span className={`listing-status ${service.status.toLowerCase().replace("_","-")}`}>{service.status.replace("_"," ")}</span><strong>₱{Math.round((service.packages[0]?.priceCentavos ?? 0)/100)}</strong>{(service.status === "DRAFT" || service.status === "REJECTED") ? <div className="listing-actions"><button className="outline-button" onClick={() => editService(service)}>Edit</button><button className="approve" onClick={() => submitService(service)}>Submit for review</button></div> : <span className="moderation-note">{service.status === "PUBLISHED" ? "Visible in marketplace" : "Awaiting admin action"}</span>}</div>{(service.status === "DRAFT" || service.status === "REJECTED") && <div className="service-media-editor"><div className="media-file-list">{service.media?.map((media) => <span key={media.id}><b>{media.kind === "COVER" ? "Cover" : "Portfolio"}</b>{media.originalName}<button onClick={() => removeMedia(service, media.id)} aria-label={`Remove ${media.originalName}`}>×</button></span>)}{!service.media?.length && <small>No media uploaded yet. Files stay private until publication.</small>}</div><div className="media-upload-grid"><label>Cover image <small>JPG, PNG, or WebP</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setMediaDrafts((value) => ({ ...value, [service.id]: { cover: event.target.files?.[0] ?? null, portfolio: value[service.id]?.portfolio ?? [] } }))}/></label><label>Portfolio <small>Up to 5 images or PDFs</small><input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setMediaDrafts((value) => ({ ...value, [service.id]: { cover: value[service.id]?.cover ?? null, portfolio: Array.from(event.target.files ?? []) } }))}/></label><button className="outline-button" disabled={uploadingMediaId === service.id} onClick={() => uploadMedia(service)}>{uploadingMediaId === service.id ? "Uploading…" : "Upload media"}</button></div></div>}</div>) : <div className="empty compact"><span>◇</span><h3>No service drafts</h3><p>Your real listings will appear here after creation.</p></div>}</section>
    {workspaceOrder&&<WebOrderWorkspace token={token} order={workspaceOrder} onClose={()=>setWorkspaceOrder(null)} onChanged={refresh}/>}
  </main>;
}

function WebOrderWorkspace({token,order,onClose,onChanged}:{token:string;order:MarketplaceOrder;onClose:()=>void;onChanged:()=>Promise<void>}){
  const [detail,setDetail]=useState<OrderWorkspace|null>(null);
  const [messages,setMessages]=useState<OrderMessage[]>([]);
  const [draft,setDraft]=useState("");
  const [sending,setSending]=useState(false);
  const [messageFiles,setMessageFiles]=useState<File[]>([]);
  const [deliveryNote,setDeliveryNote]=useState("");
  const [deliveryFiles,setDeliveryFiles]=useState<File[]>([]);
  const [submittingDelivery,setSubmittingDelivery]=useState(false);
  async function refresh(){
    const [orderResult,messageResult]=await Promise.all([api.order(token,order.id),api.messages(token,order.id)]);
    setDetail(orderResult.data);setMessages(messageResult.data);
  }
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),5000);return()=>window.clearInterval(timer);},[order.id,token]);
  async function send(event:FormEvent){event.preventDefault();const body=draft.trim();if((!body&&!messageFiles.length)||sending)return;setSending(true);try{const result=messageFiles.length?await api.sendMessageAttachments(token,order.id,messageFiles,body):await api.sendMessage(token,order.id,body);setMessages((items)=>[...items,result.data]);setDraft("");setMessageFiles([]);}catch(error){window.alert(error instanceof Error?error.message:"Unable to send message");}finally{setSending(false);}}
  async function submitDelivery(event:FormEvent){event.preventDefault();if(!detail||deliveryNote.trim().length<3||!deliveryFiles.length||submittingDelivery)return;setSubmittingDelivery(true);try{await api.deliverOrder(token,detail.id,deliveryNote.trim(),deliveryFiles);setDeliveryNote("");setDeliveryFiles([]);await Promise.all([refresh(),onChanged()]);}catch(error){window.alert(error instanceof Error?error.message:"Unable to submit delivery");}finally{setSubmittingDelivery(false);}}
  async function downloadFile(fileId:string,originalName:string){try{const blob=await api.orderFile(token,order.id,fileId);const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=originalName;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(error){window.alert(error instanceof Error?error.message:"Unable to download file");}}
  const active=detail??order;
  const canDeliver=active.status==="IN_PROGRESS"||active.status==="REVISION_REQUESTED";
  return createPortal(<div className="workspace-overlay" role="dialog" aria-modal="true" aria-label={`Order workspace ${order.orderNumber}`}><div className="web-workspace"><header><div><span className="kicker">ORDER WORKSPACE</span><h2>{order.title}</h2><small>{order.orderNumber} · {active.status.replaceAll("_"," ")}</small></div><button onClick={onClose} aria-label="Close order workspace">×</button></header><div className="web-workspace-grid"><aside><section><h3>Project requirements</h3><p>{order.requirements}</p><div className="workspace-facts"><span><small>CLIENT</small><b>{order.client.displayName}</b></span><span><small>PACKAGE</small><b>{order.package.name}</b></span><span><small>REVISIONS</small><b>{active.revisionsUsed}/{active.revisionLimit}</b></span><span><small>DUE</small><b>{new Date(order.dueAt).toLocaleDateString()}</b></span></div></section>{active.revisions?.length>0&&<section><h3>Revision instructions</h3>{active.revisions.map((revision)=><div className="workspace-revision" key={revision.id}><b>Revision {revision.sequenceNumber} · {revision.status}</b><p>{revision.instructions}</p></div>)}</section>}{canDeliver&&<section><h3>{active.status==="REVISION_REQUESTED"?"Submit revised work":"Submit completed work"}</h3><form className="delivery-form" onSubmit={submitDelivery}><textarea value={deliveryNote} onChange={(event)=>setDeliveryNote(event.target.value)} maxLength={1000} placeholder="Tell the client what you completed…" required/><label>Attach up to five files<input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.zip,.docx,.xlsx" onChange={(event)=>setDeliveryFiles(Array.from(event.target.files??[]).slice(0,5))}/></label>{deliveryFiles.length>0&&<small>{deliveryFiles.map((file)=>file.name).join(" · ")}</small>}<button disabled={submittingDelivery||deliveryNote.trim().length<3||!deliveryFiles.length}>{submittingDelivery?"Uploading…":"Submit delivery →"}</button></form></section>}{active.files?.length>0&&<section><h3>Delivery files</h3><div className="workspace-files">{active.files.map((file)=><button key={file.id} onClick={()=>void downloadFile(file.id,file.originalName)}><span>⇩</span><b>{file.originalName}</b><small>{(file.sizeBytes/1024/1024).toFixed(2)} MB · {file.purpose.replaceAll("_"," ")}</small></button>)}</div></section>}<section><h3>Order timeline</h3><div className="web-timeline">{detail?.history.map((item)=><div key={item.id}><i/><span><b>{item.toStatus.replaceAll("_"," ")}</b><small>{item.note} · {item.actor.displayName}</small><time>{new Date(item.createdAt).toLocaleString()}</time></span></div>)??<p>Loading timeline…</p>}</div></section></aside><main><div className="workspace-chat-head"><div><h3>Order messages</h3><small><i/> Private conversation with {order.client.displayName}</small></div><button onClick={()=>void refresh()}>Refresh</button></div><div className="web-messages">{messages.length?messages.map((message)=><div className={message.isMine?"mine":""} key={message.id}><i className="chat-avatar">{message.isMine?"Y":message.sender.displayName.charAt(0).toUpperCase()}</i><span><b>{message.isMine?"You":message.sender.displayName}</b>{message.body&&<em>{message.body}</em>}{message.attachments?.map((file)=><button type="button" className="chat-attachment" key={file.id} onClick={()=>void downloadFile(file.id,file.originalName)}><strong>⇩ {file.originalName}</strong><small>{(file.sizeBytes/1024/1024).toFixed(2)} MB</small></button>)}<time>{new Date(message.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time></span></div>):<div className="workspace-chat-empty">No messages yet. Start the conversation about this order.</div>}</div><form className="web-composer" onSubmit={send}><label className="message-attach" title="Attach files">＋<input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.zip,.docx,.xlsx" onChange={(event)=>setMessageFiles(Array.from(event.target.files??[]).slice(0,3))}/>{messageFiles.length>0&&<i>{messageFiles.length}</i>}</label>{messageFiles.length>0&&<div className="message-file-preview"><span>{messageFiles.map((file)=>file.name).join(" · ")}</span><button type="button" onClick={()=>setMessageFiles([])}>Clear</button></div>}<textarea value={draft} onChange={(event)=>setDraft(event.target.value)} maxLength={2000} placeholder={messageFiles.length?`${messageFiles.length} file(s) selected · Add a note…`:"Write a message about this order…"}/><button disabled={(!draft.trim()&&!messageFiles.length)||sending}>{sending?"Sending…":"Send →"}</button></form></main></div></div></div>, document.body);
}

function SchoolAdminDashboard({ token, user, notify, onLogout }: { token: string; user: AuthUser; notify: (s: string) => void; onLogout: () => void }) {
  const [queue, setQueue] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.verifications(token).then(setQueue).catch(() => notify("Unable to load your school verification queue")).finally(() => setLoading(false)); }, [token]);
  async function review(item: Verification, decision: "approve" | "reject") {
    const reason = decision === "reject" ? window.prompt("Why is this verification being rejected? The student will see this reason.")?.trim() : "";
    if (decision === "reject" && !reason) return;
    try { if (decision === "approve") await api.approveVerification(token, item.id); else await api.rejectVerification(token, item.id, reason!); setQueue((items) => items.filter((entry) => entry.id !== item.id)); notify(`Student verification ${decision === "approve" ? "approved" : "returned"}`); }
    catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to review verification"); }
  }
  async function openDocument(item: Verification) {
    try { const blob = await api.verificationDocument(token, item.id); const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener,noreferrer"); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
    catch { notify("Unable to open this private student document"); }
  }
  return <main className="dashboard-page"><DashboardHeader kicker="SCHOOL ADMINISTRATOR" title="Student verification" subtitle={`Signed in as ${user.displayName} · Only your assigned school is shown`} action={<button className="outline-action" onClick={onLogout}>Sign out</button>}/>{loading ? <div className="admin-loading">Loading your school workspace…</div> : <section className="panel admin-panel"><div className="panel-title"><div><span className="kicker">PRIVATE REVIEW QUEUE</span><h2>Students awaiting verification</h2></div><span className="queue-count">{queue.length} awaiting review</span></div>{queue.length ? queue.map((item) => <div className="verify-row" key={item.id}><span className="avatar large">{item.name.split(" ").map((part) => part[0]).slice(0,2).join("").toUpperCase()}</span><div className="verify-name"><b>{item.name}</b><small>{item.program || "Program not provided"}{item.yearLevel ? ` · Year ${item.yearLevel}` : ""}</small></div><div><b>{item.school}</b><small>Submitted {new Date(item.submittedAt).toLocaleDateString()}</small></div><button className="document-chip" onClick={() => openDocument(item)}>▤ View student ID</button><div className="verify-actions"><button className="reject" onClick={() => review(item, "reject")}>Reject</button><button className="approve" onClick={() => review(item, "approve")}>✓ Approve</button></div></div>) : <div className="empty compact"><span>◇</span><h3>No verification requests</h3><p>New submissions from your assigned school will appear here.</p></div>}</section>}</main>;
}

function AdminDashboard({ token, user, notify, onLogout }: { token: string; user: AuthUser; notify: (s: string) => void; onLogout: () => void }) {
  const [queue, setQueue] = useState<Verification[]>([]);
  const [serviceQueue, setServiceQueue] = useState<ModerationService[]>([]);
  const [schoolAdmins, setSchoolAdmins] = useState<SchoolAdministrator[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ registeredStudents: 0, activeServices: 0, completedOrders: 0, pendingVerifications: 0 });
  const [loading, setLoading] = useState(true);
  const [schoolForm, setSchoolForm] = useState({ name: "", shortName: "", emailDomain: "", address: "" });
  const [schoolAdminForm, setSchoolAdminForm] = useState({ email: "", schoolId: "" });

  async function refresh() {
    setLoading(true);
    try {
      const [nextQueue, nextServices, nextSchools, nextSchoolAdmins, nextStats] = await Promise.all([api.verifications(token), api.moderationServices(token), api.adminSchools(token), api.schoolAdministrators(token), api.adminStats(token)]);
      setQueue(nextQueue); setServiceQueue(nextServices); setSchools(nextSchools); setSchoolAdmins(nextSchoolAdmins); setStats(nextStats);
    } catch { notify("Unable to load administrator data"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [token]);

  async function review(item: Verification, decision: "approve" | "reject") {
    const reason = decision === "reject" ? window.prompt("Why is this verification being rejected? The student will see this reason.")?.trim() : "";
    if (decision === "reject" && !reason) return;
    try {
      if (decision === "approve") await api.approveVerification(token, item.id); else await api.rejectVerification(token, item.id, reason!);
      setQueue((items) => items.filter((entry) => entry.id !== item.id));
      setStats((value) => ({ ...value, pendingVerifications: Math.max(0, value.pendingVerifications - 1) }));
      notify(`Verification ${decision === "approve" ? "approved" : "returned"}`);
    } catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to review verification"); }
  }
  async function openDocument(item: Verification) {
    try {
      const blob = await api.verificationDocument(token, item.id);
      const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener,noreferrer"); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { notify("Unable to open the private student document"); }
  }
  async function moderateService(item: ModerationService, decision: "approve" | "reject") {
    const reason = decision === "reject" ? window.prompt("Why is this service being rejected? The provider will see this reason.")?.trim() : "";
    if (decision === "reject" && !reason) return;
    try {
      if (decision === "approve") await api.approveService(token, item.id); else await api.rejectService(token, item.id, reason!);
      setServiceQueue((items) => items.filter((entry) => entry.id !== item.id));
      if (decision === "approve") setStats((value) => ({ ...value, activeServices: value.activeServices + 1 }));
      notify(`Service ${decision === "approve" ? "approved and published" : "returned to the provider"}`);
    } catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to moderate service"); }
  }
  async function addSchool(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await api.createSchool(token, { ...schoolForm, emailDomain: schoolForm.emailDomain || undefined, address: schoolForm.address || undefined });
      setSchools((items) => [...items, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSchoolForm({ name: "", shortName: "", emailDomain: "", address: "" }); notify("Participating school added as pending");
    } catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to add school"); }
  }
  async function changeSchoolStatus(school: School, status: "PENDING" | "ACTIVE" | "DISABLED") {
    try { const updated = await api.updateSchoolStatus(token, school.id, status); setSchools((items) => items.map((item) => item.id === school.id ? updated : item)); notify(`${school.shortName} is now ${status.toLowerCase()}`); }
    catch { notify("Unable to update school status"); }
  }
  async function assignSchoolAdmin(event: FormEvent) {
    event.preventDefault();
    try {
      const assignment = await api.assignSchoolAdministrator(token, schoolAdminForm.email.trim(), schoolAdminForm.schoolId);
      setSchoolAdmins((items) => [assignment, ...items.filter((item) => item.userId !== assignment.userId)]);
      setSchoolAdminForm({ email: "", schoolId: "" }); notify("School administrator access assigned");
    } catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to assign school administrator"); }
  }
  async function removeSchoolAdmin(item: SchoolAdministrator) {
    if (!window.confirm(`Remove school administrator access from ${item.user.displayName}?`)) return;
    try { await api.removeSchoolAdministrator(token, item.userId); setSchoolAdmins((items) => items.filter((entry) => entry.userId !== item.userId)); notify("School administrator access removed"); }
    catch (caught) { notify(caught instanceof Error ? caught.message : "Unable to remove school administrator"); }
  }

  return <main className="dashboard-page">
    <DashboardHeader kicker="CAMPUSGIG ADMIN" title="Platform overview" subtitle={`Signed in as ${user.displayName}`} action={<button className="outline-action" onClick={onLogout}>Sign out</button>}/>
    <div className="stats-grid"><Stat label="Registered students" value={String(stats.registeredStudents)} change="Real database accounts" icon="◎"/><Stat label="Active services" value={String(stats.activeServices)} change="Published listings" icon="◇"/><Stat label="Completed orders" value={String(stats.completedOrders)} change="Persisted orders" icon="✓"/><Stat label="Pending verification" value={String(queue.length)} change="Requires admin review" icon="!"/></div>
    {loading ? <div className="admin-loading">Loading administrator workspace…</div> : <>
      <section className="panel admin-panel"><div className="panel-title"><div><span className="kicker">MARKETPLACE SAFETY</span><h2>Service moderation queue</h2></div><span className="queue-count">{serviceQueue.length} awaiting review</span></div>{serviceQueue.length ? serviceQueue.map((item) => <div className="service-review-row" key={item.id}><div className="service-review-main"><b>{item.title}</b><small>{item.category.name} · {item.deliveryMethod.replace("_", " ")}</small><p>{item.description}</p></div><div><b>{item.provider.displayName}</b><small>{item.provider.studentProfile?.school?.shortName ?? "Verified provider"}</small></div><div className="service-review-package"><b>₱{Math.round((item.packages[0]?.priceCentavos ?? 0) / 100)}</b><small>{item.packages[0]?.deliveryDays ?? 0} day delivery · {item.packages[0]?.revisionLimit ?? 0} revisions</small></div><div className="verify-actions"><button className="reject" onClick={() => moderateService(item, "reject")}>Reject</button><button className="approve" onClick={() => moderateService(item, "approve")}>✓ Publish</button></div></div>) : <div className="empty compact"><span>◇</span><h3>No services awaiting review</h3><p>Provider submissions will appear here before they become public.</p></div>}</section>
      <section className="panel admin-panel"><div className="panel-title"><div><span className="kicker">TRUST & SAFETY</span><h2>Student verification queue</h2></div><span className="queue-count">{queue.length} awaiting review</span></div>{queue.length ? queue.map((item) => <div className="verify-row" key={item.id}><span className="avatar large">{item.name.split(" ").map((part) => part[0]).slice(0,2).join("").toUpperCase()}</span><div className="verify-name"><b>{item.name}</b><small>{item.program || "Program not provided"}{item.yearLevel ? ` · Year ${item.yearLevel}` : ""}</small></div><div><b>{item.school}</b><small>Submitted {new Date(item.submittedAt).toLocaleDateString()}</small></div><button className="document-chip" onClick={() => openDocument(item)}>▤ View student ID</button><div className="verify-actions"><button className="reject" onClick={() => review(item, "reject")}>Reject</button><button className="approve" onClick={() => review(item, "approve")}>✓ Approve</button></div></div>) : <div className="empty compact"><span>◇</span><h3>No verification requests</h3><p>New student submissions will appear here.</p></div>}</section>
      <div className="admin-school-grid"><section className="panel"><div className="panel-title"><div><span className="kicker">SCHOOL ADMINISTRATORS</span><h2>Verification access</h2></div><span className="queue-count">{schoolAdmins.length} assigned</span></div><form className="school-admin-form" onSubmit={assignSchoolAdmin}><label>Existing account email<input type="email" value={schoolAdminForm.email} onChange={(event) => setSchoolAdminForm({ ...schoolAdminForm, email: event.target.value })} placeholder="administrator@school.edu.ph" required/></label><label>Assigned school<select value={schoolAdminForm.schoolId} onChange={(event) => setSchoolAdminForm({ ...schoolAdminForm, schoolId: event.target.value })} required><option value="">Select an active school</option>{schools.filter((school) => school.status === "ACTIVE").map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label><button className="primary-button wide">Assign access</button></form><div className="school-admin-list">{schoolAdmins.map((item) => <div className="school-admin-row" key={item.userId}><div><b>{item.user.displayName}</b><small>{item.user.email} · {item.school.shortName}</small></div><button className="reject" onClick={() => removeSchoolAdmin(item)}>Remove</button></div>)}{schoolAdmins.length === 0 && <p className="admin-empty-copy">No school administrators assigned yet.</p>}</div></section>
      <section className="panel"><div className="panel-title"><div><span className="kicker">PARTICIPATING SCHOOLS</span><h2>School access</h2></div><span className="queue-count">{schools.length} registered</span></div><div className="school-admin-list">{schools.map((school) => <div className="school-admin-row" key={school.id}><div><b>{school.name}</b><small>{school.shortName} · {school.city}</small></div><span className={`school-status ${school.status?.toLowerCase()}`}>{school.status}</span><select value={school.status} onChange={(event) => changeSchoolStatus(school, event.target.value as "PENDING" | "ACTIVE" | "DISABLED")}><option value="PENDING">Pending</option><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></select></div>)}{schools.length === 0 && <p className="admin-empty-copy">No participating schools have been registered.</p>}</div></section>
      <section className="panel"><span className="kicker">ADD A REAL SCHOOL</span><h2>Register participating school</h2><form className="school-admin-form" onSubmit={addSchool}><label>School name<input value={schoolForm.name} onChange={(event) => setSchoolForm({ ...schoolForm, name: event.target.value })} required minLength={2}/></label><label>Short name<input value={schoolForm.shortName} onChange={(event) => setSchoolForm({ ...schoolForm, shortName: event.target.value })} required minLength={2} maxLength={30}/></label><label>Email domain <small>Optional</small><input value={schoolForm.emailDomain} onChange={(event) => setSchoolForm({ ...schoolForm, emailDomain: event.target.value })} placeholder="school.edu.ph"/></label><label>Address <small>Optional</small><input value={schoolForm.address} onChange={(event) => setSchoolForm({ ...schoolForm, address: event.target.value })}/></label><button className="primary-button wide">Add as pending</button></form></section></div>
    </>}
  </main>;
}

function DashboardHeader({ kicker, title, subtitle, action }: { kicker: string; title: string; subtitle: string; action?: React.ReactNode }) { return <div className="dashboard-header"><div><span className="kicker">{kicker}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>; }
function Stat({ label, value, change, icon }: { label: string; value: string; change: string; icon: string }) { return <div className="stat-card"><div><small>{label}</small><strong>{value}</strong><span>{change}</span></div><i>{icon}</i></div>; }
function Status({ label }: { label: string }) { return <span className={`status ${label.toLowerCase().replace(" ", "-")}`}>{label}</span>; }
function Footer() { return <footer><div className="footer-inner"><Logo/><p>Student skills. Real opportunities.<br/>Built for the schools of Lipa City.</p><div><b>Marketplace</b><a>Browse services</a><a>Become a provider</a></div><div><b>CampusGig</b><a>About us</a><a>Community guidelines</a></div><div><b>Support</b><a>Help center</a><a>Contact us</a></div></div><div className="copyright">© 2026 CampusGig · A student capstone project</div></footer>; }
