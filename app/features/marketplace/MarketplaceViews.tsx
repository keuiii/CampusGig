"use client";

/* eslint-disable @next/next/no-img-element -- Marketplace media uses the runtime-configured CampusGig API origin. */
import { type CSSProperties, FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Footer } from "../../components/dashboard";
import { Icon } from "../../components/brand";
import {
  isInitialContentLoad,
  SkeletonCollection,
} from "../../components/Skeletons";
import { api } from "../../lib/api";
import {
  formatDeliveryMinutes,
  isLegacyServicePricingModel,
  isSinglePriceV2ServicePricingModel,
} from "../../lib/pricing-model";
import type {
  Category,
  DeliveryOption,
  MarketplaceQuote,
  School,
  Service,
} from "../../types";
import {
  marketplaceBudgetLabels,
  type MarketplaceBudgetRange,
  type MarketplaceSort,
} from "./marketplace-filter";

const maximumAdvanceBookingDays = 365;

const deliveryOptionLabel = (option: DeliveryOption) =>
  option === "NORMAL"
    ? "Normal delivery"
    : `${option.replace("RUSH_", "").replace("_HOURS", "").replaceAll("_", "-")}-hour Rush`;

const money = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function manilaDateInputValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

function formatDeliveryDate(date: string) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00+08:00`));
}

export function Home({
  query,
  setQuery,
  activeCategory,
  setActiveCategory,
  categories,
  schools,
  selectedSchoolId,
  setSelectedSchoolId,
  budgetRange,
  setBudgetRange,
  minimumRating,
  setMinimumRating,
  maximumDeliveryDays,
  setMaximumDeliveryDays,
  marketplaceSort,
  setMarketplaceSort,
  savedOnly,
  setSavedOnly,
  signedIn,
  savedServiceIds,
  savingServiceId,
  toggleSavedService,
  filtered,
  serviceTotal,
  servicesHaveMore,
  servicesLoadingMore,
  servicesError,
  retryServices,
  loadMoreServices,
  loading,
  openService,
  openProvider,
}: {
  query: string;
  setQuery: (v: string) => void;
  activeCategory: string;
  setActiveCategory: (v: string) => void;
  categories: Category[];
  schools: School[];
  selectedSchoolId: string;
  setSelectedSchoolId: (v: string) => void;
  budgetRange: MarketplaceBudgetRange;
  setBudgetRange: (v: MarketplaceBudgetRange) => void;
  minimumRating: number;
  setMinimumRating: (v: number) => void;
  maximumDeliveryDays: number;
  setMaximumDeliveryDays: (v: number) => void;
  marketplaceSort: MarketplaceSort;
  setMarketplaceSort: (v: MarketplaceSort) => void;
  savedOnly: boolean;
  setSavedOnly: (value: boolean) => void;
  signedIn: boolean;
  savedServiceIds: ReadonlySet<string>;
  savingServiceId: string;
  toggleSavedService: (serviceId: string) => void;
  filtered: Service[];
  serviceTotal: number;
  servicesHaveMore: boolean;
  servicesLoadingMore: boolean;
  servicesError: string;
  retryServices: () => void;
  loadMoreServices: () => void;
  loading: boolean;
  openService: (s: Service) => void;
  openProvider: (providerId: string, returnTo: "home" | "service") => void;
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
    query.trim() ||
      activeCategory !== "All" ||
      selectedSchoolId ||
      budgetRange !== "any" ||
      minimumRating ||
      maximumDeliveryDays ||
      marketplaceSort !== "recommended" ||
      savedOnly,
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
              role="search"
            >
              <Icon name="search" />
              <input
                value={query}
                maxLength={120}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="What service are you looking for?"
                aria-label="Search marketplace services"
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
              <span className="mini-icon purple">CG</span>
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
            <div className="spark s1">●</div>
            <div className="spark s2">○</div>
            <div className="spark s3">●</div>
          </div>
        </section>

        <section className="marketplace-stats" aria-label="Marketplace summary">
          <div>
            <strong>
              <i className="live-stat-dot" aria-hidden="true" />
              {serviceTotal}
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
            <span>Providers shown</span>
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
              <span className="result-count" role="status" aria-live="polite">
                {loading
                  ? "Searching services..."
                  : `${serviceTotal} result${serviceTotal !== 1 ? "s" : ""}`}
              </span>
              {signedIn && (
                <button
                  type="button"
                  aria-pressed={savedOnly}
                  onClick={() => setSavedOnly(!savedOnly)}
                >
                  {savedOnly ? "Show all services" : "Saved services"}
                </button>
              )}
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              >
                Refine search ↑
              </button>
            </div>
          </div>
          <div
            className="marketplace-filter-panel"
            aria-label="Service filters"
          >
            <label>
              <span>Budget range</span>
              <select
                value={budgetRange}
                onChange={(event) =>
                  setBudgetRange(event.target.value as MarketplaceBudgetRange)
                }
              >
                {Object.entries(marketplaceBudgetLabels).map(
                  ([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              <span>Minimum rating</span>
              <select
                value={minimumRating}
                onChange={(event) =>
                  setMinimumRating(Number(event.target.value))
                }
              >
                <option value="0">Any rating</option>
                <option value="4.5">4.5 and above</option>
                <option value="4">4.0 and above</option>
                <option value="3">3.0 and above</option>
              </select>
            </label>
            <label>
              <span>Delivery time</span>
              <select
                value={maximumDeliveryDays}
                onChange={(event) =>
                  setMaximumDeliveryDays(Number(event.target.value))
                }
              >
                <option value="0">Any delivery</option>
                <option value="1">Within 1 day</option>
                <option value="3">Within 3 days</option>
                <option value="7">Within 7 days</option>
              </select>
            </label>
            <label>
              <span>Sort services</span>
              <select
                value={marketplaceSort}
                onChange={(event) =>
                  setMarketplaceSort(event.target.value as MarketplaceSort)
                }
              >
                <option value="recommended">Recommended</option>
                <option value="newest">Newest</option>
                <option value="rating">Top rated</option>
                <option value="price-low">Price: low to high</option>
                <option value="delivery-fast">Fastest delivery</option>
              </select>
            </label>
          </div>
          {hasFilters && (
            <div className="active-filter-bar">
              <span>Showing</span>
              {query.trim() && <b>“{query.trim()}”</b>}
              {activeCategory !== "All" && <b>{activeCategory}</b>}
              {selectedSchool && (
                <b>{selectedSchool.shortName || selectedSchool.name}</b>
              )}
              {budgetRange !== "any" && (
                <b>{marketplaceBudgetLabels[budgetRange]}</b>
              )}
              {minimumRating > 0 && <b>{minimumRating}+ rating</b>}
              {maximumDeliveryDays > 0 && (
                <b>Within {maximumDeliveryDays} days</b>
              )}
              {marketplaceSort !== "recommended" && (
                <b>Sorted: {marketplaceSort.replaceAll("-", " ")}</b>
              )}
              {savedOnly && <b>Saved services</b>}
              <button
                onClick={() => {
                  setQuery("");
                  setActiveCategory("All");
                  setSelectedSchoolId("");
                  setBudgetRange("any");
                  setMinimumRating(0);
                  setMaximumDeliveryDays(0);
                  setMarketplaceSort("recommended");
                  setSavedOnly(false);
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
                saved={savedServiceIds.has(service.id)}
                saving={savingServiceId === service.id}
                toggleSaved={() => toggleSavedService(service.id)}
                open={() => openService(service)}
                openProvider={() => openProvider(service.providerId, "home")}
              />
            ))}
            {isInitialContentLoad(loading, filtered.length) && (
              <SkeletonCollection
                kind="service"
                count={3}
                label="Loading services"
                className="service-grid-skeleton"
              />
            )}
            {!loading && !servicesError && filtered.length === 0 && (
              <div className="empty">
                <span>⌕</span>
                <h3>
                  {savedOnly
                    ? "No saved services found"
                    : query.trim()
                      ? `No results for “${query.trim()}”`
                      : hasFilters
                        ? "No services match these filters"
                        : "No services published yet"}
                </h3>
                <p>
                  {savedOnly
                    ? "Save a service or adjust your filters to find it here."
                    : query.trim() || hasFilters
                      ? "Try a broader phrase, another skill, or clear one of the filters."
                      : "Published provider services will appear here automatically."}
                </p>
              </div>
            )}
          </div>
          {servicesError && (
            <div className="marketplace-page-error" role="alert">
              <span>{servicesError}</span>
              <button type="button" onClick={retryServices}>
                Retry
              </button>
            </div>
          )}
          {servicesHaveMore && (
            <div className="marketplace-load-more">
              <button
                type="button"
                className="secondary-button"
                disabled={servicesLoadingMore}
                onClick={loadMoreServices}
              >
                {servicesLoadingMore
                  ? "Loading services…"
                  : `Show more services (${filtered.length} of ${serviceTotal})`}
              </button>
            </div>
          )}
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
                  <span className="step-icon">↔</span>
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
  saved,
  saving,
  toggleSaved,
  open,
  openProvider,
}: {
  service: Service;
  saved: boolean;
  saving: boolean;
  toggleSaved: () => void;
  open: () => void;
  openProvider: () => void;
}) {
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
            width={720}
            height={420}
            loading="lazy"
            decoding="async"
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
          disabled={saving}
          onClick={(e) => {
            e.stopPropagation();
            toggleSaved();
          }}
        >
          {saved ? "♥" : "♡"}
        </button>
      </div>
      <div className="service-body">
        <button
          type="button"
          className="provider-line provider-line-button"
          aria-label={`View ${service.provider}'s profile`}
          onClick={(event) => {
            event.stopPropagation();
            openProvider();
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span className="avatar">
            {service.providerHasAvatar ? (
              <img
                src={api.avatarUrl(
                  service.providerId,
                  service.providerAvatarVersion,
                )}
                alt={`${service.provider} profile`}
                width={48}
                height={48}
                loading="lazy"
                decoding="async"
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
        </button>
        <h3>{service.title}</h3>
        <div className="rating">
          <span>★</span> <b>{service.rating}</b>{" "}
          <small>({service.reviews})</small>
        </div>
        <div className="card-footer">
          <small>
            {isSinglePriceV2ServicePricingModel(service.pricingModel)
              ? "FIXED PRICE"
              : isLegacyServicePricingModel(service.pricingModel)
                ? "STARTING AT"
                : "PRICE UNAVAILABLE"}
          </small>
          <strong>
            {isLegacyServicePricingModel(service.pricingModel) ||
            isSinglePriceV2ServicePricingModel(service.pricingModel)
              ? `₱${service.price}`
              : "—"}
          </strong>
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
  authenticated,
  token,
  onBook,
  back,
  openProvider,
}: {
  service: Service;
  authenticated: boolean;
  token: string;
  onBook: (
    serviceId: string,
    servicePackageId: string | undefined,
    requirements: string,
    requestedDeliveryDate: string | undefined,
    deliveryOption?: DeliveryOption,
  ) => Promise<void>;
  back: () => void;
  openProvider: () => void;
}) {
  const legacyPricing = isLegacyServicePricingModel(service.pricingModel);
  const singlePriceV2 = isSinglePriceV2ServicePricingModel(
    service.pricingModel,
  );
  const [packageId, setPackageId] = useState(service.packages[0]?.id ?? "");
  const [requirements, setRequirements] = useState("");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [packageDirection, setPackageDirection] = useState<"left" | "right">(
    "right",
  );
  const [error, setError] = useState("");
  const [deliveryOption, setDeliveryOption] =
    useState<DeliveryOption>("NORMAL");
  const [quote, setQuote] = useState<MarketplaceQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const selectedPackage =
    service.packages.find((item) => item.id === packageId) ??
    service.packages[0];
  const requirementsLength = requirements.trim().length;
  const selectedPrice = (selectedPackage?.priceCentavos ?? 0) / 100;
  const selectedPackageIndex = Math.max(
    0,
    service.packages.findIndex((item) => item.id === selectedPackage?.id),
  );
  const todayInManila = manilaDateInputValue();
  const minimumDeliveryDate = addCalendarDays(
    todayInManila,
    selectedPackage?.deliveryDays ?? 1,
  );
  const maximumDeliveryDate = addCalendarDays(
    todayInManila,
    maximumAdvanceBookingDays,
  );

  useEffect(() => {
    if (!singlePriceV2 || !token) {
      setQuote(null);
      return;
    }
    let current = true;
    setQuoteLoading(true);
    setError("");
    void api
      .quoteService(token, service.id, deliveryOption)
      .then((result) => {
        if (current) setQuote(result.data);
      })
      .catch((reason) => {
        if (current) {
          setQuote(null);
          setError(
            reason instanceof Error ? reason.message : "Unable to load quote.",
          );
        }
      })
      .finally(() => {
        if (current) setQuoteLoading(false);
      });
    return () => {
      current = false;
    };
  }, [deliveryOption, service.id, singlePriceV2, token]);

  useEffect(() => {
    setRequestedDeliveryDate((current) =>
      !current || current < minimumDeliveryDate || current > maximumDeliveryDate
        ? minimumDeliveryDate
        : current,
    );
  }, [maximumDeliveryDate, minimumDeliveryDate]);

  useEffect(() => {
    if (!confirming) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) setConfirming(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [confirming, submitting]);

  function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!legacyPricing && !singlePriceV2) return;
    if (!service.acceptingOrders) {
      setError(
        "This provider is at capacity. Please check back after they complete current work.",
      );
      return;
    }
    if (!authenticated) {
      void onBook(
        service.id,
        legacyPricing ? selectedPackage?.id : undefined,
        requirements.trim(),
        legacyPricing ? requestedDeliveryDate : undefined,
        singlePriceV2 ? deliveryOption : undefined,
      );
      return;
    }
    if (
      (legacyPricing && !selectedPackage) ||
      (singlePriceV2 && (!quote || quoteLoading)) ||
      requirementsLength < 10 ||
      (legacyPricing &&
        (!requestedDeliveryDate ||
          requestedDeliveryDate < minimumDeliveryDate ||
          requestedDeliveryDate > maximumDeliveryDate)) ||
      submitting
    )
      return;
    setConfirming(true);
  }

  async function confirmBooking() {
    if (
      (!legacyPricing && !singlePriceV2) ||
      !service.acceptingOrders ||
      (legacyPricing && !selectedPackage) ||
      (singlePriceV2 && !quote) ||
      requirementsLength < 10 ||
      submitting
    )
      return;
    setSubmitting(true);
    setError("");
    try {
      await onBook(
        service.id,
        legacyPricing ? selectedPackage!.id : undefined,
        requirements.trim(),
        legacyPricing ? requestedDeliveryDate : undefined,
        singlePriceV2 ? deliveryOption : undefined,
      );
      setConfirming(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to send your service request.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <main className="detail-page">
      <button className="back-button" onClick={back}>
        ← Back to services
      </button>
      <div className="detail-grid">
        <section>
          <span className="detail-category">{service.category}</span>
          <h1>{service.title}</h1>
          <button
            type="button"
            className="detail-provider detail-provider-button"
            onClick={openProvider}
            aria-label={`View ${service.provider}'s public profile`}
          >
            <span className="avatar large">
              {service.providerHasAvatar ? (
                <img
                  src={api.avatarUrl(
                    service.providerId,
                    service.providerAvatarVersion,
                  )}
                  alt={`${service.provider} profile`}
                  width={64}
                  height={64}
                  decoding="async"
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
          </button>
          <div className={`detail-cover ${service.color ?? "service-green"}`}>
            {service.coverMediaId ? (
              <img
                src={api.serviceMediaUrl(service.id, service.coverMediaId)}
                alt={`${service.title} cover`}
                width={960}
                height={540}
                decoding="async"
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
          {singlePriceV2 ? (
            <>
              <div className="package-details">
                <div className="package-title">
                  <h3>One fixed price</h3>
                  <strong>
                    ₱
                    {Math.round(
                      (service.basePriceCentavos ?? 0) / 100,
                    ).toLocaleString()}
                  </strong>
                </div>
                <p>{service.description}</p>
                <div className="package-meta">
                  <span>
                    <Icon name="clock" />{" "}
                    {formatDeliveryMinutes(service.normalDeliveryMinutes)}{" "}
                    delivery
                  </span>
                  <span>
                    ↻ {service.includedRevisionLimit ?? 0} included revision
                    {service.includedRevisionLimit === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div
                className="tier-tabs"
                role="radiogroup"
                aria-label="Delivery option"
              >
                {(quote?.eligibleDeliveryOptions ?? ["NORMAL"]).map(
                  (option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={deliveryOption === option}
                      className={deliveryOption === option ? "active" : ""}
                      onClick={() => setDeliveryOption(option)}
                    >
                      {deliveryOptionLabel(option)}
                    </button>
                  ),
                )}
              </div>
              {quoteLoading ? (
                <p className="safe-note" aria-live="polite">
                  Calculating authoritative quote…
                </p>
              ) : quote ? (
                <dl className="request-confirm-summary">
                  <div>
                    <dt>Service price</dt>
                    <dd>{money(quote.basePriceCentavos)}</dd>
                  </div>
                  {quote.rushSurchargeCentavos > 0 && (
                    <div>
                      <dt>{deliveryOptionLabel(quote.deliveryOption)}</dt>
                      <dd>{money(quote.rushSurchargeCentavos)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>CampusGig service fee</dt>
                    <dd>{money(quote.platformFeeCentavos)}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>{money(quote.clientTotalCentavos)}</dd>
                  </div>
                </dl>
              ) : null}
              {!bookingOpen ? (
                <button
                  className="primary-button wide"
                  disabled={
                    !service.acceptingOrders || (authenticated && !quote)
                  }
                  onClick={() => setBookingOpen(true)}
                >
                  {authenticated && quote
                    ? `Continue — ${money(quote.clientTotalCentavos)}`
                    : "Sign in to request"}
                </button>
              ) : (
                <form className="web-booking-form" onSubmit={submitBooking}>
                  <label htmlFor="web-v2-order-requirements">
                    Project requirements
                  </label>
                  <textarea
                    id="web-v2-order-requirements"
                    value={requirements}
                    onChange={(event) => {
                      setRequirements(event.target.value);
                      setError("");
                    }}
                    maxLength={3000}
                    autoFocus
                    placeholder="Describe what you need, preferred style, dimensions, and references."
                  />
                  <div className="web-booking-meta">
                    <small>Minimum 10 characters</small>
                    <small>{requirementsLength}/3000</small>
                  </div>
                  <small className="web-booking-date-note">
                    Exact deadline starts after payment is confirmed.
                  </small>
                  {error && (
                    <p className="web-booking-error" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="web-booking-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setBookingOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="primary-button"
                      disabled={
                        requirementsLength < 10 ||
                        submitting ||
                        (authenticated && (!quote || quoteLoading))
                      }
                    >
                      {submitting
                        ? "Sending request…"
                        : authenticated
                          ? "Review request"
                          : "Sign in to send"}
                    </button>
                  </div>
                </form>
              )}
              <small className="safe-note">
                Payment is requested only after the provider accepts.
              </small>
            </>
          ) : legacyPricing ? (
            <>
              <div
                className="tier-tabs"
                role="tablist"
                aria-label="Service packages"
                style={
                  {
                    "--tier-index": selectedPackageIndex,
                    "--tier-count": Math.max(1, service.packages.length),
                  } as CSSProperties
                }
              >
                {service.packages.map((item, index) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedPackage?.id === item.id}
                    className={selectedPackage?.id === item.id ? "active" : ""}
                    onClick={() => {
                      if (item.id === selectedPackage?.id) return;
                      setPackageDirection(
                        index > selectedPackageIndex ? "right" : "left",
                      );
                      setPackageId(item.id);
                      setError("");
                    }}
                    key={item.id}
                  >
                    {item.tier.charAt(0) + item.tier.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
              <div
                key={selectedPackage?.id}
                className={`package-details package-slide-${packageDirection}`}
              >
                <div className="package-title">
                  <h3>{selectedPackage?.name ?? "Unavailable package"}</h3>
                  <strong>₱{selectedPrice.toLocaleString()}</strong>
                </div>
                <p>{selectedPackage?.description}</p>
                <div className="package-meta">
                  <span>
                    <Icon name="clock" /> {selectedPackage?.deliveryDays ?? 0}{" "}
                    day
                    {selectedPackage?.deliveryDays === 1 ? "" : "s"} delivery
                  </span>
                  <span>
                    ↻ {selectedPackage?.revisionLimit ?? 0} revision
                    {selectedPackage?.revisionLimit === 1 ? "" : "s"}
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
              </div>
              {!bookingOpen ? (
                <button
                  className="primary-button wide"
                  disabled={!service.acceptingOrders}
                  onClick={() => setBookingOpen(true)}
                >
                  Continue — ₱{selectedPrice.toLocaleString()}{" "}
                  <Icon name="arrow" />
                </button>
              ) : (
                <form className="web-booking-form" onSubmit={submitBooking}>
                  <label htmlFor="web-order-requirements">
                    Project requirements
                  </label>
                  <textarea
                    id="web-order-requirements"
                    value={requirements}
                    onChange={(event) => {
                      setRequirements(event.target.value);
                      setError("");
                    }}
                    maxLength={3000}
                    autoFocus
                    placeholder="Describe what you need, preferred style, dimensions, deadline details, and references."
                  />
                  <div className="web-booking-meta">
                    <small>Minimum 10 characters</small>
                    <small>{requirementsLength}/3000</small>
                  </div>
                  <label htmlFor="web-order-delivery-date">
                    Requested delivery date
                  </label>
                  <input
                    id="web-order-delivery-date"
                    className="web-booking-date"
                    type="date"
                    value={requestedDeliveryDate}
                    min={minimumDeliveryDate}
                    max={maximumDeliveryDate}
                    onChange={(event) => {
                      setRequestedDeliveryDate(event.target.value);
                      setError("");
                    }}
                    required
                  />
                  <small className="web-booking-date-note">
                    Earliest available date for this package is{" "}
                    {formatDeliveryDate(minimumDeliveryDate)}.
                  </small>
                  {error && (
                    <p className="web-booking-error" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="web-booking-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={submitting}
                      onClick={() => setBookingOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="primary-button"
                      disabled={
                        requirementsLength < 10 ||
                        !requestedDeliveryDate ||
                        requestedDeliveryDate < minimumDeliveryDate ||
                        requestedDeliveryDate > maximumDeliveryDate ||
                        submitting ||
                        !service.acceptingOrders
                      }
                    >
                      {submitting
                        ? "Sending request…"
                        : authenticated
                          ? "Send request"
                          : "Sign in to send"}
                      {!submitting && <Icon name="arrow" />}
                    </button>
                  </div>
                </form>
              )}
              {!service.acceptingOrders && (
                <p className="web-booking-error" role="status">
                  This provider is at capacity. Please check back after they
                  complete current work.
                </p>
              )}
              <small className="safe-note">
                Payment is requested only after the provider accepts.
              </small>
            </>
          ) : (
            <>
              <div className="package-details">
                <h3>Unsupported pricing model</h3>
                <p>Update CampusGig to view the terms for this listing.</p>
              </div>
              <button className="primary-button wide" disabled>
                Booking unavailable
              </button>
            </>
          )}
        </aside>
      </div>
      {(legacyPricing || singlePriceV2) &&
      confirming &&
      (selectedPackage || quote)
        ? createPortal(
            <div
              className="request-confirm-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !submitting)
                  setConfirming(false);
              }}
            >
              <section
                className="request-confirm-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="request-confirm-title"
              >
                <span className="request-confirm-icon">
                  <Icon name="check" />
                </span>
                <span className="kicker">CONFIRM SERVICE REQUEST</span>
                <h2 id="request-confirm-title">Send this request?</h2>
                <p>Review the details before notifying {service.provider}.</p>
                <dl className="request-confirm-summary">
                  <div>
                    <dt>Service</dt>
                    <dd>{service.title}</dd>
                  </div>
                  <div>
                    <dt>{legacyPricing ? "Package" : "Delivery"}</dt>
                    <dd>
                      {legacyPricing
                        ? selectedPackage!.name
                        : deliveryOptionLabel(quote!.deliveryOption)}
                    </dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>
                      {legacyPricing
                        ? `₱${selectedPrice.toLocaleString()}`
                        : money(quote!.clientTotalCentavos)}
                    </dd>
                  </div>
                  <div>
                    <dt>{legacyPricing ? "Requested delivery" : "Deadline"}</dt>
                    <dd>
                      {legacyPricing
                        ? formatDeliveryDate(requestedDeliveryDate)
                        : "Starts after payment confirmation"}
                    </dd>
                  </div>
                </dl>
                <div className="request-confirm-requirements">
                  <small>YOUR REQUIREMENTS</small>
                  <p>{requirements.trim()}</p>
                </div>
                <div className="request-confirm-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={submitting}
                    onClick={() => setConfirming(false)}
                  >
                    Review again
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={submitting}
                    onClick={confirmBooking}
                    autoFocus
                  >
                    {submitting ? "Sending request…" : "Confirm and send"}
                    {!submitting && <Icon name="arrow" />}
                  </button>
                </div>
                <small className="safe-note">
                  No payment is collected until the provider accepts.
                </small>
              </section>
            </div>,
            document.body,
          )
        : null}
    </main>
  );
}
