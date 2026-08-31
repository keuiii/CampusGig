"use client";

import { FormEvent, useState } from "react";
import { Footer } from "../../components/dashboard";
import { Icon } from "../../components/brand";
import { api } from "../../lib/api";
import type { Category, School, Service } from "../../types";

export function Home({
  query,
  setQuery,
  activeCategory,
  setActiveCategory,
  categories,
  schools,
  selectedSchoolId,
  setSelectedSchoolId,
  filtered,
  loading,
  openService,
}: {
  query: string;
  setQuery: (v: string) => void;
  activeCategory: string;
  setActiveCategory: (v: string) => void;
  categories: Category[];
  schools: School[];
  selectedSchoolId: string;
  setSelectedSchoolId: (v: string) => void;
  filtered: Service[];
  loading: boolean;
  openService: (s: Service) => void;
}) {
  function submit(e: FormEvent) {
    e.preventDefault();
    document
      .getElementById("services-marketplace")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const selectedSchool = schools.find(
    (school) => school.id === selectedSchoolId,
  );
  const hasFilters = Boolean(
    query.trim() || activeCategory !== "All" || selectedSchoolId,
  );
  const quickSearches = ["Logo design", "Tutoring", "Programming"];
  const activeProviderCount = new Set(
    filtered.map((service) => service.providerId),
  ).size;
  return (
    <>
      <main>
        <section className="hero">
          <div className="hero-orb one" />
          <div className="hero-orb two" />
          <div className="hero-copy">
            <span className="eyebrow">BUILT BY STUDENTS, FOR STUDENTS</span>
            <h1>
              Turn student skills into
              <br />
              <em>real opportunities.</em>
            </h1>
            <p>
              Discover trusted, affordable services from verified students
              across participating schools in Lipa City.
            </p>
            <form
              className={`search-box ${query.trim() ? "has-query" : ""}`}
              onSubmit={submit}
            >
              <Icon name="search" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="What service are you looking for?"
              />
              {query && (
                <button
                  type="button"
                  className="search-clear"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  ×
                </button>
              )}
              <button className="search-submit">Search</button>
            </form>
            <div className="quick-searches" aria-label="Popular searches">
              <span>Try</span>
              {quickSearches.map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setQuery(item);
                    document
                      .getElementById("services-marketplace")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className={`school-filter ${selectedSchool ? "active" : ""}`}>
              <label htmlFor="preferred-school">Preferred school</label>
              <div className="school-select-shell">
                <span aria-hidden="true">⌂</span>
                <select
                  id="preferred-school"
                  value={selectedSchoolId}
                  onChange={(e) => setSelectedSchoolId(e.target.value)}
                >
                  <option value="">All participating schools</option>
                  {schools.map((school) => (
                    <option value={school.id} key={school.id}>
                      {school.shortName || school.name}
                    </option>
                  ))}
                </select>
                {selectedSchool && (
                  <button
                    type="button"
                    aria-label="Clear preferred school"
                    onClick={() => setSelectedSchoolId("")}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            <div className="trust-row">
              <span>
                <b>✓</b> Verified students
              </span>
              <span>
                <b>✓</b> School-based trust
              </span>
              <span>
                <b>✓</b> Secure order tracking
              </span>
            </div>
          </div>
          <div className="hero-art">
            <div className="floating-card fc-one">
              <span className="mini-icon purple">✦</span>
              <div>
                <b>Student Services</b>
                <small>Verified campus talent</small>
              </div>
            </div>
            <div className="student-portrait">
              <span className="portrait-hair" />
              <span className="portrait-face">◡</span>
              <span className="portrait-body" />
            </div>
            <div className="floating-card fc-two">
              <span className="avatar">CG</span>
              <div>
                <b>
                  Verified Provider <i>✓</i>
                </b>
                <small>Student-led services</small>
              </div>
            </div>
            <div className="spark s1">✦</div>
            <div className="spark s2">✧</div>
            <div className="spark s3">✦</div>
          </div>
        </section>

        <section className="marketplace-stats" aria-label="Marketplace summary">
          <div>
            <strong>
              <i className="live-stat-dot" aria-hidden="true" />
              {filtered.length}
            </strong>
            <span>Active services</span>
          </div>
          <i />
          <div>
            <strong>{schools.length}</strong>
            <span>Participating schools</span>
          </div>
          <i />
          <div>
            <strong>{categories.length}</strong>
            <span>Skill categories</span>
          </div>
          <i />
          <div>
            <strong>{activeProviderCount}</strong>
            <span>Active student providers</span>
          </div>
        </section>

        <section className="section categories-section">
          <div className="section-heading">
            <div>
              <span className="kicker">EXPLORE BY CATEGORY</span>
              <h2>Whatever you need, a student can help.</h2>
            </div>
            <button
              className="text-link"
              onClick={() => setActiveCategory("All")}
            >
              View all <Icon name="arrow" />
            </button>
          </div>
          <div className="category-grid">
            {categories.map((category) => (
              <button
                key={category.name}
                className={`category-card ${activeCategory === category.name ? "selected" : ""}`}
                aria-pressed={activeCategory === category.name}
                onClick={() =>
                  setActiveCategory(
                    activeCategory === category.name ? "All" : category.name,
                  )
                }
              >
                <span className={`category-icon ${category.color ?? "mint"}`}>
                  {category.icon ?? "◇"}
                </span>
                <b>{category.name}</b>
                <small>{category.serviceCount} services</small>
                <span className="corner-arrow">↗</span>
              </button>
            ))}
            {!loading && categories.length === 0 && (
              <div className="empty">
                <span>◇</span>
                <h3>No categories yet</h3>
                <p>
                  Categories will appear after they are created in the backend.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="section services-section" id="services-marketplace">
          <div className="section-heading">
            <div>
              <span className="kicker">POPULAR RIGHT NOW</span>
              <h2>
                {activeCategory === "All"
                  ? "Services students love"
                  : activeCategory}
              </h2>
            </div>
            <div className="marketplace-results-head">
              <span className="result-count">
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              >
                Refine search ↑
              </button>
            </div>
          </div>
          {hasFilters && (
            <div className="active-filter-bar">
              <span>Showing</span>
              {query.trim() && <b>“{query.trim()}”</b>}
              {activeCategory !== "All" && <b>{activeCategory}</b>}
              {selectedSchool && (
                <b>{selectedSchool.shortName || selectedSchool.name}</b>
              )}
              <button
                onClick={() => {
                  setQuery("");
                  setActiveCategory("All");
                  setSelectedSchoolId("");
                }}
              >
                Clear all ×
              </button>
            </div>
          )}
          <div className="service-grid">
            {filtered.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                open={() => openService(service)}
              />
            ))}
            {loading && (
              <>
                {[1, 2, 3].map((item) => (
                  <div
                    className="service-skeleton"
                    key={item}
                    aria-hidden="true"
                  >
                    <i />
                    <span />
                    <span />
                    <span />
                  </div>
                ))}
              </>
            )}
            {!loading && filtered.length === 0 && (
              <div className="empty">
                <span>⌕</span>
                <h3>No services published yet</h3>
                <p>
                  Published provider services will appear here automatically.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="how-section">
          <div className="how-orb how-orb-one" />
          <div className="how-orb how-orb-two" />
          <div className="section how-inner">
            <div className="how-heading">
              <span className="kicker light">HOW CAMPUSGIG WORKS</span>
              <h2>
                A simple path from idea to <em>finished.</em>
              </h2>
              <p>
                CampusGig keeps discovery, collaboration, and delivery together
                so every student project stays clear and organized.
              </p>
            </div>
            <div className="steps">
              <article className="how-step">
                <div className="step-top">
                  <span className="step-number">01</span>
                  <span className="step-icon">⌕</span>
                </div>
                <span className="step-label">EXPLORE</span>
                <b>Discover campus talent</b>
                <p>
                  Browse verified student providers, compare packages, and
                  filter services by your preferred school.
                </p>
                <small>
                  Find the right match <span>→</span>
                </small>
              </article>
              <article className="how-step featured">
                <div className="step-top">
                  <span className="step-number">02</span>
                  <span className="step-icon">✦</span>
                </div>
                <span className="step-label">COLLABORATE</span>
                <b>Book with confidence</b>
                <p>
                  Choose a package, share clear requirements, and follow every
                  update through your CampusGig order.
                </p>
                <small>
                  Stay connected <span>→</span>
                </small>
              </article>
              <article className="how-step">
                <div className="step-top">
                  <span className="step-number">03</span>
                  <span className="step-icon">✓</span>
                </div>
                <span className="step-label">COMPLETE</span>
                <b>Receive and review</b>
                <p>
                  Review the final work, request revisions when needed, and
                  recognize excellent student talent.
                </p>
                <small>
                  Support student skills <span>→</span>
                </small>
              </article>
            </div>
            <button
              className="how-cta"
              onClick={() => {
                setActiveCategory("All");
                document
                  .getElementById("services-marketplace")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Explore student services <Icon name="arrow" />
            </button>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function ServiceCard({
  service,
  open,
}: {
  service: Service;
  open: () => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <article
      className="service-card"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open();
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${service.title}`}
    >
      <div className={`service-cover ${service.color ?? "service-green"}`}>
        {service.coverMediaId ? (
          <img
            src={api.serviceMediaUrl(service.id, service.coverMediaId)}
            alt={`${service.title} cover`}
          />
        ) : (
          <>
            <span className="cover-grid" />
            <span className="cover-icon">{service.icon ?? "◇"}</span>
          </>
        )}
        <span className="category-pill">{service.category}</span>
        <button
          className={`heart ${saved ? "saved" : ""}`}
          aria-label={saved ? "Remove saved service" : "Save service"}
          aria-pressed={saved}
          onClick={(e) => {
            e.stopPropagation();
            setSaved((value) => !value);
          }}
        >
          {saved ? "♥" : "♡"}
        </button>
      </div>
      <div className="service-body">
        <div className="provider-line">
          <span className="avatar">
            {service.providerHasAvatar ? (
              <img
                src={api.avatarUrl(
                  service.providerId,
                  service.providerAvatarVersion,
                )}
                alt={`${service.provider} profile`}
              />
            ) : (
              service.initials
            )}
          </span>
          <div>
            <b>
              {service.provider} <i>✓</i>
            </b>
            <small>{service.school}</small>
          </div>
        </div>
        <h3>{service.title}</h3>
        <div className="rating">
          <span>★</span> <b>{service.rating}</b>{" "}
          <small>({service.reviews})</small>
        </div>
        <div className="card-footer">
          <small>STARTING AT</small>
          <strong>₱{service.price}</strong>
        </div>
        <span className="service-open-cue">
          View service <b>→</b>
        </span>
      </div>
    </article>
  );
}

export function ServiceDetail({
  service,
  booked,
  onBook,
  back,
}: {
  service: Service;
  booked: boolean;
  onBook: () => void;
  back: () => void;
}) {
  const [tier, setTier] = useState<"Basic" | "Standard" | "Premium">("Basic");
  const prices = {
    Basic: service.price,
    Standard: service.price * 2,
    Premium: service.price * 3,
  };
  if (booked)
    return (
      <main className="success-page">
        <div className="success-mark">
          <Icon name="check" />
        </div>
        <span className="kicker">BOOKING FLOW READY</span>
        <h1>Connect order creation to continue.</h1>
        <p>
          The interface has collected the selected service and package. The
          backend will assign the real order number and persist its lifecycle.
        </p>
        <div className="success-order">
          <div>
            <small>ORDER NUMBER</small>
            <b>Assigned by API</b>
          </div>
          <div>
            <small>SERVICE</small>
            <b>{service.category}</b>
          </div>
          <div>
            <small>TOTAL</small>
            <b>₱{prices[tier]}</b>
          </div>
        </div>
        <button className="primary-button" onClick={back}>
          Return to marketplace
        </button>
      </main>
    );
  return (
    <main className="detail-page">
      <button className="back-button" onClick={back}>
        ← Back to services
      </button>
      <div className="detail-grid">
        <section>
          <span className="detail-category">{service.category}</span>
          <h1>{service.title}</h1>
          <div className="detail-provider">
            <span className="avatar large">
              {service.providerHasAvatar ? (
                <img
                  src={api.avatarUrl(
                    service.providerId,
                    service.providerAvatarVersion,
                  )}
                  alt={`${service.provider} profile`}
                />
              ) : (
                service.initials
              )}
            </span>
            <div>
              <b>
                {service.provider} <i>✓</i>
              </b>
              <span>
                {service.program} · {service.school}
              </span>
              <small>
                <span className="star">★</span> {service.rating} (
                {service.reviews} reviews)
              </small>
            </div>
          </div>
          <div className={`detail-cover ${service.color ?? "service-green"}`}>
            {service.coverMediaId ? (
              <img
                src={api.serviceMediaUrl(service.id, service.coverMediaId)}
                alt={`${service.title} cover`}
              />
            ) : (
              <>
                <span className="cover-grid" />
                <span>{service.icon ?? "◇"}</span>
              </>
            )}
          </div>
          <div className="about">
            <h2>About this service</h2>
            <p>{service.description}</p>
            {service.portfolio?.length ? (
              <>
                <h3>Portfolio</h3>
                <div className="portfolio-links">
                  {service.portfolio.map((item) => (
                    <a
                      key={item.id}
                      href={api.serviceMediaUrl(service.id, item.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.originalName}
                    </a>
                  ))}
                </div>
              </>
            ) : null}
            <h3>What you&apos;ll get</h3>
            <ul>
              <li>
                <Icon name="check" />
                Original, student-focused work
              </li>
              <li>
                <Icon name="check" />
                Editable source files
              </li>
              <li>
                <Icon name="check" />
                Clear in-app communication
              </li>
              <li>
                <Icon name="check" />
                Revisions included with your package
              </li>
            </ul>
          </div>
        </section>
        <aside className="booking-card">
          <div className="tier-tabs">
            {(["Basic", "Standard", "Premium"] as const).map((item) => (
              <button
                className={tier === item ? "active" : ""}
                onClick={() => setTier(item)}
                key={item}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="package-title">
            <h3>{tier} package</h3>
            <strong>₱{prices[tier]}</strong>
          </div>
          <p>
            {tier === "Basic"
              ? "A focused package for a simple student requirement."
              : tier === "Standard"
                ? "More coverage and revisions for larger projects."
                : "Complete support for your most important projects."}
          </p>
          <div className="package-meta">
            <span>
              <Icon name="clock" />{" "}
              {tier === "Basic"
                ? service.delivery
                : tier === "Standard"
                  ? "3 days"
                  : "4 days"}{" "}
              delivery
            </span>
            <span>
              ↻ {tier === "Basic" ? 2 : tier === "Standard" ? 3 : 5} revisions
            </span>
          </div>
          <ul>
            <li>
              <Icon name="check" />
              Requirements consultation
            </li>
            <li>
              <Icon name="check" />
              Final high-quality output
            </li>
            <li>
              <Icon name="check" />
              Source file included
            </li>
          </ul>
          <button className="primary-button wide" onClick={onBook}>
            Continue — ₱{prices[tier]} <Icon name="arrow" />
          </button>
          <small className="safe-note">
            You won&apos;t be charged in this prototype.
          </small>
        </aside>
      </div>
    </main>
  );
}
