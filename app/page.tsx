"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { defaultCategories } from "./catalog";
import { api, backendConfigured } from "./lib/api";
import type { Category, DashboardStats, Order, ProviderStats, School, Service, Verification } from "./types";

type View = "home" | "service" | "orders" | "provider" | "admin";

function Logo() {
  return <button className="logo" onClick={() => location.reload()}><span className="logo-mark">C</span><span>Campus<span>Gig</span></span></button>;
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
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(backendConfigured);
  const [adminStats, setAdminStats] = useState<DashboardStats>({ registeredStudents: 0, activeServices: 0, completedOrders: 0, pendingVerifications: 0 });
  const [providerStats, setProviderStats] = useState<ProviderStats>({ activeOrders: 0, pendingRequests: 0, completedOrders: 0, averageRating: 0, reviewCount: 0, profileStrength: 0 });
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [toast, setToast] = useState("");
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    if (!backendConfigured) return;
    Promise.allSettled([api.services(), api.categories(), api.schools(), api.orders(), api.verifications(), api.adminStats(), api.providerStats()])
      .then(([serviceResult, categoryResult, schoolResult, orderResult, verificationResult, adminResult, providerResult]) => {
        if (serviceResult.status === "fulfilled") setServices(serviceResult.value);
        if (categoryResult.status === "fulfilled" && categoryResult.value.length > 0) setCategories(categoryResult.value);
        if (schoolResult.status === "fulfilled") setSchools(schoolResult.value);
        if (orderResult.status === "fulfilled") setOrders(orderResult.value);
        if (verificationResult.status === "fulfilled") setVerifications(verificationResult.value);
        if (adminResult.status === "fulfilled") setAdminStats(adminResult.value);
        if (providerResult.status === "fulfilled") setProviderStats(providerResult.value);
      })
      .finally(() => setLoading(false));
  }, []);

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
      <header className="topbar">
        <div className="nav-wrap">
          <Logo />
          <nav>
            <button className={view === "home" ? "active" : ""} onClick={() => navigate("home")}>Discover</button>
            <button className={view === "orders" ? "active" : ""} onClick={() => navigate("orders")}>My orders</button>
            <button className={view === "provider" ? "active" : ""} onClick={() => navigate("provider")}>Provider dashboard</button>
            <button className={view === "admin" ? "active" : ""} onClick={() => navigate("admin")}>Admin</button>
          </nav>
          <div className="nav-actions">
            <button className="icon-button" aria-label="Notifications"><Icon name="bell"/><span className="dot" /></button>
            <button className="profile-chip"><span className="avatar small">?</span><span>Account</span></button>
          </div>
        </div>
      </header>

      {view === "home" && <Home query={query} setQuery={setQuery} activeCategory={activeCategory} setActiveCategory={setActiveCategory} categories={categories} schools={schools} selectedSchoolId={selectedSchoolId} setSelectedSchoolId={setSelectedSchoolId} filtered={filtered} loading={loading} openService={openService} />}
      {view === "service" && selected && <ServiceDetail service={selected} booked={booked} onBook={() => setBooked(true)} back={() => navigate("home")} />}
      {view === "orders" && <OrdersView orders={orders} notify={notify} />}
      {view === "provider" && <ProviderDashboard orders={orders} stats={providerStats} notify={notify} />}
      {view === "admin" && <AdminDashboard initialQueue={verifications} stats={adminStats} notify={notify} />}

      {toast && <div className="toast"><span className="toast-check"><Icon name="check" /></span>{toast}</div>}
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

      <section className="section services-section">
        <div className="section-heading"><div><span className="kicker">POPULAR RIGHT NOW</span><h2>{activeCategory === "All" ? "Services students love" : activeCategory}</h2></div><span className="result-count">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span></div>
        <div className="service-grid">
          {filtered.map((service) => <ServiceCard key={service.id} service={service} open={() => openService(service)} />)}
          {loading && <div className="empty"><span>◌</span><h3>Loading services</h3><p>Connecting to the CampusGig API.</p></div>}
          {!loading && filtered.length === 0 && <div className="empty"><span>⌕</span><h3>No services published yet</h3><p>Published provider services will appear here automatically.</p></div>}
        </div>
      </section>

      <section className="how-section">
        <div className="section how-inner"><span className="kicker light">HOW CAMPUSGIG WORKS</span><h2>From idea to done—in three simple steps.</h2><div className="steps">
          <div><span>01</span><b>Discover</b><p>Browse services from verified student providers.</p></div><i>→</i>
          <div><span>02</span><b>Book & collaborate</b><p>Send requirements and chat inside your order.</p></div><i>→</i>
          <div><span>03</span><b>Receive & review</b><p>Approve the work and support student talent.</p></div>
        </div></div>
      </section>
    </main>
    <Footer />
  </>;
}

function ServiceCard({ service, open }: { service: Service; open: () => void }) {
  return <article className="service-card" onClick={open}>
    <div className={`service-cover ${service.color ?? "service-green"}`}><span className="cover-grid"/><span className="cover-icon">{service.icon ?? "◇"}</span><span className="category-pill">{service.category}</span><button className="heart" aria-label="Save service" onClick={(e) => e.stopPropagation()}>♡</button></div>
    <div className="service-body"><div className="provider-line"><span className="avatar">{service.initials}</span><div><b>{service.provider} <i>✓</i></b><small>{service.school}</small></div></div><h3>{service.title}</h3><div className="rating"><span>★</span> <b>{service.rating}</b> <small>({service.reviews})</small></div><div className="card-footer"><small>STARTING AT</small><strong>₱{service.price}</strong></div></div>
  </article>;
}

function ServiceDetail({ service, booked, onBook, back }: { service: Service; booked: boolean; onBook: () => void; back: () => void }) {
  const [tier, setTier] = useState<"Basic" | "Standard" | "Premium">("Basic");
  const prices = { Basic: service.price, Standard: service.price * 2, Premium: service.price * 3 };
  if (booked) return <main className="success-page"><div className="success-mark"><Icon name="check" /></div><span className="kicker">BOOKING FLOW READY</span><h1>Connect order creation to continue.</h1><p>The interface has collected the selected service and package. The backend will assign the real order number and persist its lifecycle.</p><div className="success-order"><div><small>ORDER NUMBER</small><b>Assigned by API</b></div><div><small>SERVICE</small><b>{service.category}</b></div><div><small>TOTAL</small><b>₱{prices[tier]}</b></div></div><button className="primary-button" onClick={back}>Return to marketplace</button></main>;
  return <main className="detail-page">
    <button className="back-button" onClick={back}>← Back to services</button>
    <div className="detail-grid">
      <section><span className="detail-category">{service.category}</span><h1>{service.title}</h1><div className="detail-provider"><span className="avatar large">{service.initials}</span><div><b>{service.provider} <i>✓</i></b><span>{service.program} · {service.school}</span><small><span className="star">★</span> {service.rating} ({service.reviews} reviews)</small></div></div><div className={`detail-cover ${service.color ?? "service-green"}`}><span className="cover-grid"/><span>{service.icon ?? "◇"}</span></div><div className="about"><h2>About this service</h2><p>{service.description}</p><h3>What you&apos;ll get</h3><ul><li><Icon name="check"/>Original, student-focused work</li><li><Icon name="check"/>Editable source files</li><li><Icon name="check"/>Clear in-app communication</li><li><Icon name="check"/>Revisions included with your package</li></ul></div></section>
      <aside className="booking-card"><div className="tier-tabs">{(["Basic", "Standard", "Premium"] as const).map((item) => <button className={tier === item ? "active" : ""} onClick={() => setTier(item)} key={item}>{item}</button>)}</div><div className="package-title"><h3>{tier} package</h3><strong>₱{prices[tier]}</strong></div><p>{tier === "Basic" ? "A focused package for a simple student requirement." : tier === "Standard" ? "More coverage and revisions for larger projects." : "Complete support for your most important projects."}</p><div className="package-meta"><span><Icon name="clock"/> {tier === "Basic" ? service.delivery : tier === "Standard" ? "3 days" : "4 days"} delivery</span><span>↻ {tier === "Basic" ? 2 : tier === "Standard" ? 3 : 5} revisions</span></div><ul><li><Icon name="check"/>Requirements consultation</li><li><Icon name="check"/>Final high-quality output</li><li><Icon name="check"/>Source file included</li></ul><button className="primary-button wide" onClick={onBook}>Continue — ₱{prices[tier]} <Icon name="arrow"/></button><small className="safe-note">You won&apos;t be charged in this prototype.</small></aside>
    </div>
  </main>;
}

function OrdersView({ orders, notify }: { orders: Order[]; notify: (s: string) => void }) {
  const active = orders.filter((order) => order.status !== "Completed").length;
  const completed = orders.filter((order) => order.status === "Completed").length;
  return <main className="dashboard-page"><DashboardHeader kicker="MY PROJECTS" title="Orders" subtitle="Track your bookings and keep every project moving."/><div className="filter-tabs"><button className="active">All orders <span>{orders.length}</span></button><button>Active <span>{active}</span></button><button>Completed <span>{completed}</span></button></div><div className="table-card"><div className="table-head"><span>Order</span><span>Client</span><span>Amount</span><span>Due date</span><span>Status</span><span/></div>{orders.map((order) => <div className="table-row" key={order.id}><span><b>{order.service}</b><small>{order.id}</small></span><span>{order.client}</span><span><b>₱{order.amount}</b></span><span>{order.due}</span><span><Status label={order.status}/></span><span><button className="row-button" onClick={() => notify(`${order.id} opened`)}>View order →</button></span></div>)}{orders.length === 0 && <div className="empty compact"><span>◇</span><h3>No orders yet</h3><p>Bookings will appear here after the backend creates them.</p></div>}</div></main>;
}

function ProviderDashboard({ orders, stats, notify }: { orders: Order[]; stats: ProviderStats; notify: (s: string) => void }) {
  return <main className="dashboard-page"><DashboardHeader kicker="PROVIDER WORKSPACE" title="Provider dashboard" subtitle="Your services, orders, and reputation will appear here." action={<button className="primary-button" onClick={() => notify("Connect the service creation endpoint to continue")}>＋ Create a service</button>}/><div className="stats-grid"><Stat label="Active orders" value={String(stats.activeOrders)} change="No fabricated activity" icon="↗"/><Stat label="Pending requests" value={String(stats.pendingRequests)} change="Synced from the API" icon="◷"/><Stat label="Completed orders" value={String(stats.completedOrders)} change="Synced from the API" icon="✓"/><Stat label="Average rating" value={stats.averageRating.toFixed(1)} change={`From ${stats.reviewCount} reviews`} icon="★"/></div><div className="dashboard-grid"><section className="panel"><div className="panel-title"><div><span className="kicker">ORDERS</span><h2>Recent activity</h2></div><button className="text-link">View all <Icon name="arrow"/></button></div>{orders.map((order) => <div className="activity-row" key={order.id}><span className="activity-icon">{order.service.slice(0,1)}</span><div><b>{order.service}</b><small>{order.client} · {order.id}</small></div><strong>₱{order.amount}</strong><Status label={order.status}/></div>)}{orders.length === 0 && <div className="empty compact"><span>◇</span><h3>No provider activity</h3><p>Real orders will populate this panel.</p></div>}</section><aside className="panel profile-panel"><span className="kicker">PROFILE STRENGTH</span><div className="profile-score"><strong>{stats.profileStrength}%</strong><div><b>Profile not configured</b><small>Complete your provider profile</small></div></div><div className="progress"><span style={{ width: `${stats.profileStrength}%` }}/></div><ul><li>○ Student verification</li><li>○ Add a profile photo</li><li>○ Add portfolio projects</li><li>○ Write a provider bio</li></ul><button className="outline-button" onClick={() => notify("Connect the profile endpoint to continue")}>Set up profile</button></aside></div></main>;
}

function AdminDashboard({ initialQueue, stats, notify }: { initialQueue: Verification[]; stats: DashboardStats; notify: (s: string) => void }) {
  const [queue, setQueue] = useState(initialQueue);
  useEffect(() => setQueue(initialQueue), [initialQueue]);
  async function review(item: Verification, decision: "approve" | "reject") {
    try {
      if (decision === "approve") await api.approveVerification(item.id); else await api.rejectVerification(item.id);
      setQueue((items) => items.filter((entry) => entry.id !== item.id));
      notify(`Verification ${decision === "approve" ? "approved" : "returned"}`);
    } catch { notify("Backend connection is required for this action"); }
  }
  return <main className="dashboard-page"><DashboardHeader kicker="CAMPUSGIG ADMIN" title="Platform overview" subtitle="Manage trust, safety, and student participation."/><div className="stats-grid"><Stat label="Registered students" value={String(stats.registeredStudents)} change="Synced from the API" icon="◎"/><Stat label="Active services" value={String(stats.activeServices)} change="Synced from the API" icon="◇"/><Stat label="Completed orders" value={String(stats.completedOrders)} change="Synced from the API" icon="✓"/><Stat label="Pending verification" value={String(queue.length)} change="Requires admin review" icon="!"/></div><section className="panel admin-panel"><div className="panel-title"><div><span className="kicker">TRUST & SAFETY</span><h2>Student verification queue</h2></div><span className="queue-count">{queue.length} awaiting review</span></div>{queue.length ? queue.map((item) => <div className="verify-row" key={item.id}><span className="avatar large">{item.initials}</span><div className="verify-name"><b>{item.name}</b><small>{item.program}</small></div><div><b>{item.school}</b><small>Submitted {item.submitted}</small></div><span className="document-chip">▤ Student ID</span><div className="verify-actions"><button className="reject" onClick={() => review(item, "reject")}>Reject</button><button className="approve" onClick={() => review(item, "approve")}>✓ Approve</button></div></div>) : <div className="empty compact"><span>◇</span><h3>No verification requests</h3><p>New submissions from the backend will appear here.</p></div>}</section></main>;
}

function DashboardHeader({ kicker, title, subtitle, action }: { kicker: string; title: string; subtitle: string; action?: React.ReactNode }) { return <div className="dashboard-header"><div><span className="kicker">{kicker}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>; }
function Stat({ label, value, change, icon }: { label: string; value: string; change: string; icon: string }) { return <div className="stat-card"><div><small>{label}</small><strong>{value}</strong><span>{change}</span></div><i>{icon}</i></div>; }
function Status({ label }: { label: string }) { return <span className={`status ${label.toLowerCase().replace(" ", "-")}`}>{label}</span>; }
function Footer() { return <footer><div className="footer-inner"><Logo/><p>Student skills. Real opportunities.<br/>Built for the schools of Lipa City.</p><div><b>Marketplace</b><a>Browse services</a><a>Become a provider</a></div><div><b>CampusGig</b><a>About us</a><a>Community guidelines</a></div><div><b>Support</b><a>Help center</a><a>Contact us</a></div></div><div className="copyright">© 2026 CampusGig · A student capstone project</div></footer>; }
