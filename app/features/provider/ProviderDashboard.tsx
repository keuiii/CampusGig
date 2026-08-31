"use client";

import { FormEvent, useEffect, useState } from "react";
import { DashboardHeader, Stat } from "../../components/dashboard";
import { api } from "../../lib/api";
import { WebOrderWorkspace } from "../orders/WebOrderWorkspace";
import type {
  AuthUser,
  Category,
  MarketplaceOrder,
  ProviderProfile,
  ProviderService,
  ProviderStats,
} from "../../types";

export function ProviderDashboard({
  token,
  user,
  categories,
  notify,
  onLogout,
  openOrderId,
  onOrderOpened,
}: {
  token: string;
  user: AuthUser;
  categories: Category[];
  notify: (s: string) => void;
  onLogout: () => void;
  openOrderId?: string | null;
  onOrderOpened?: () => void;
}) {
  type PackageDraft = {
    tier: "BASIC" | "STANDARD" | "PREMIUM";
    enabled: boolean;
    name: string;
    description: string;
    pricePesos: string;
    deliveryDays: string;
    revisionLimit: string;
  };
  const blankPackages = (): PackageDraft[] => [
    {
      tier: "BASIC",
      enabled: true,
      name: "Basic package",
      description: "",
      pricePesos: "",
      deliveryDays: "3",
      revisionLimit: "1",
    },
    {
      tier: "STANDARD",
      enabled: false,
      name: "Standard package",
      description: "",
      pricePesos: "",
      deliveryDays: "5",
      revisionLimit: "2",
    },
    {
      tier: "PREMIUM",
      enabled: false,
      name: "Premium package",
      description: "",
      pricePesos: "",
      deliveryDays: "7",
      revisionLimit: "3",
    },
  ];
  const [stats, setStats] = useState<ProviderStats>({
    activeOrders: 0,
    pendingRequests: 0,
    completedOrders: 0,
    averageRating: 0,
    reviewCount: 0,
    profileStrength: 0,
  });
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [providerOrders, setProviderOrders] = useState<MarketplaceOrder[]>([]);
  const [workspaceOrder, setWorkspaceOrder] = useState<MarketplaceOrder | null>(
    null,
  );
  const [profileForm, setProfileForm] = useState({
    headline: "",
    bio: "",
    skills: "",
    isAvailable: true,
  });
  const [serviceForm, setServiceForm] = useState({
    categoryId: categories[0]?.id ?? "",
    title: "",
    description: "",
    deliveryMethod: "ONLINE",
    campusLocation: "",
    packages: blankPackages(),
  });
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [mediaDrafts, setMediaDrafts] = useState<
    Record<string, { cover: File | null; portfolio: File[] }>
  >({});
  const [uploadingMediaId, setUploadingMediaId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingService, setSavingService] = useState(false);

  async function refresh() {
    try {
      const [nextStats, profileResult, nextServices, nextOrders] =
        await Promise.all([
          api.providerStats(token),
          api.providerProfile(token),
          api.providerServices(token),
          api.providerOrders(token),
        ]);
      setStats(nextStats);
      setProfile(profileResult.data);
      setServices(nextServices);
      setProviderOrders(nextOrders);
      if (profileResult.data)
        setProfileForm({
          headline: profileResult.data.headline,
          bio: profileResult.data.bio,
          skills: profileResult.data.skills.join(", "),
          isAvailable: profileResult.data.isAvailable,
        });
    } catch {
      notify("Unable to load provider workspace");
    }
  }
  useEffect(() => {
    void refresh();
  }, [token]);
  useEffect(() => {
    if (!openOrderId || !providerOrders.length) return;
    const target = providerOrders.find((order) => order.id === openOrderId);
    if (target) {
      setWorkspaceOrder(target);
      onOrderOpened?.();
    }
  }, [openOrderId, providerOrders]);
  useEffect(() => {
    if (!serviceForm.categoryId && categories[0])
      setServiceForm((value) => ({ ...value, categoryId: categories[0].id }));
  }, [categories, serviceForm.categoryId]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const result = await api.updateProviderProfile(token, {
        headline: profileForm.headline,
        bio: profileForm.bio,
        skills: profileForm.skills
          .split(",")
          .map((skill) => skill.trim())
          .filter(Boolean),
        isAvailable: profileForm.isAvailable,
      });
      setProfile(result.data);
      notify("Provider profile saved");
      await refresh();
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to save provider profile",
      );
    } finally {
      setSavingProfile(false);
    }
  }
  function servicePayload() {
    return {
      categoryId: serviceForm.categoryId,
      title: serviceForm.title,
      description: serviceForm.description,
      deliveryMethod: serviceForm.deliveryMethod,
      campusLocation: serviceForm.campusLocation || undefined,
      packages: serviceForm.packages
        .filter((item) => item.enabled)
        .map((item) => ({
          tier: item.tier,
          name: item.name,
          description: item.description,
          priceCentavos: Math.round(Number(item.pricePesos) * 100),
          deliveryDays: Number(item.deliveryDays),
          revisionLimit: Number(item.revisionLimit),
        })),
    };
  }
  const normalizedSkills = profileForm.skills
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);
  const profileValid =
    profileForm.headline.trim().length >= 3 &&
    profileForm.bio.trim().length >= 20 &&
    normalizedSkills.length > 0;
  const profileDirty =
    !profile ||
    profile.headline !== profileForm.headline.trim() ||
    profile.bio !== profileForm.bio.trim() ||
    profile.skills.join(", ") !== normalizedSkills.join(", ") ||
    profile.isAvailable !== profileForm.isAvailable;
  const enabledPackages = serviceForm.packages.filter((item) => item.enabled);
  const serviceValid = Boolean(
    serviceForm.categoryId &&
      serviceForm.title.trim().length >= 10 &&
      serviceForm.description.trim().length >= 50 &&
      enabledPackages.length &&
      enabledPackages.every(
        (item) =>
          item.name.trim() &&
          item.description.trim().length >= 10 &&
          Number(item.pricePesos) > 0 &&
          Number(item.deliveryDays) > 0 &&
          Number(item.revisionLimit) >= 0,
      ),
  );
  const editingService = editingServiceId
    ? services.find((service) => service.id === editingServiceId)
    : null;
  const serviceDirty =
    !editingService ||
    JSON.stringify(servicePayload()) !==
      JSON.stringify({
        categoryId: editingService.category.id,
        title: editingService.title,
        description: editingService.description,
        deliveryMethod: editingService.deliveryMethod,
        campusLocation: editingService.campusLocation || undefined,
        packages: editingService.packages.map((item) => ({
          tier: item.tier,
          name: item.name,
          description: item.description,
          priceCentavos: item.priceCentavos,
          deliveryDays: item.deliveryDays,
          revisionLimit: item.revisionLimit,
        })),
      });
  function resetServiceForm() {
    setEditingServiceId(null);
    setServiceForm({
      categoryId: categories[0]?.id ?? "",
      title: "",
      description: "",
      deliveryMethod: "ONLINE",
      campusLocation: "",
      packages: blankPackages(),
    });
  }
  function updatePackage(
    tier: PackageDraft["tier"],
    changes: Partial<PackageDraft>,
  ) {
    setServiceForm((value) => ({
      ...value,
      packages: value.packages.map((item) =>
        item.tier === tier ? { ...item, ...changes } : item,
      ),
    }));
  }
  function editService(service: ProviderService) {
    const packages = blankPackages().map((draft) => {
      const saved = service.packages.find((item) => item.tier === draft.tier);
      return saved
        ? {
            tier: draft.tier,
            enabled: true,
            name: saved.name,
            description: saved.description,
            pricePesos: String(saved.priceCentavos / 100),
            deliveryDays: String(saved.deliveryDays),
            revisionLimit: String(saved.revisionLimit),
          }
        : draft;
    });
    setEditingServiceId(service.id);
    setServiceForm({
      categoryId: service.category.id,
      title: service.title,
      description: service.description,
      deliveryMethod: service.deliveryMethod,
      campusLocation: service.campusLocation ?? "",
      packages,
    });
    window.scrollTo({ top: 430, behavior: "smooth" });
  }
  async function saveService(event: FormEvent) {
    event.preventDefault();
    setSavingService(true);
    try {
      const result = editingServiceId
        ? await api.updateProviderService(
            token,
            editingServiceId,
            servicePayload(),
          )
        : await api.createProviderService(token, servicePayload());
      setServices((items) =>
        editingServiceId
          ? items.map((item) =>
              item.id === editingServiceId ? result.data : item,
            )
          : [result.data, ...items],
      );
      notify(
        editingServiceId ? "Service draft updated" : "Service draft created",
      );
      resetServiceForm();
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to save service",
      );
    } finally {
      setSavingService(false);
    }
  }
  async function submitService(service: ProviderService) {
    try {
      const result = await api.submitProviderService(token, service.id);
      setServices((items) =>
        items.map((item) =>
          item.id === service.id
            ? { ...item, status: result.data.status }
            : item,
        ),
      );
      notify("Service submitted for administrator review");
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to submit service",
      );
    }
  }
  async function uploadMedia(service: ProviderService) {
    const selected = mediaDrafts[service.id];
    if (!selected?.cover && !selected?.portfolio.length)
      return notify("Choose a cover or portfolio file first");
    setUploadingMediaId(service.id);
    try {
      const result = await api.uploadProviderMedia(
        token,
        service.id,
        selected.cover,
        selected.portfolio,
      );
      setServices((items) =>
        items.map((item) =>
          item.id === service.id ? { ...item, media: result.data } : item,
        ),
      );
      setMediaDrafts((value) => ({
        ...value,
        [service.id]: { cover: null, portfolio: [] },
      }));
      notify("Service media uploaded privately");
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to upload service media",
      );
    } finally {
      setUploadingMediaId(null);
    }
  }
  async function removeMedia(service: ProviderService, mediaId: string) {
    try {
      await api.removeProviderMedia(token, service.id, mediaId);
      setServices((items) =>
        items.map((item) =>
          item.id === service.id
            ? {
                ...item,
                media: item.media.filter((media) => media.id !== mediaId),
              }
            : item,
        ),
      );
      notify("Service media removed");
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to remove service media",
      );
    }
  }
  async function decideOrder(
    order: MarketplaceOrder,
    decision: "accept" | "reject",
  ) {
    const reason =
      decision === "reject"
        ? window
            .prompt("Tell the client why you cannot accept this request:")
            ?.trim()
        : "";
    if (decision === "reject" && (!reason || reason.length < 3)) return;
    try {
      const result =
        decision === "accept"
          ? await api.acceptOrder(token, order.id)
          : await api.rejectOrder(token, order.id, reason!);
      setProviderOrders((items) =>
        items.map((item) => (item.id === order.id ? result.data : item)),
      );
      notify(result.message);
      await refresh();
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to update the request",
      );
    }
  }
  async function startOrder(order: MarketplaceOrder) {
    try {
      const result = await api.startOrder(token, order.id);
      setProviderOrders((items) =>
        items.map((item) => (item.id === order.id ? result.data : item)),
      );
      notify(result.message);
      await refresh();
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to start the order",
      );
    }
  }

  return (
    <main className="dashboard-page">
      <DashboardHeader
        kicker="PROVIDER WORKSPACE"
        title="Provider dashboard"
        subtitle={`Verified account · ${user.displayName}`}
        action={
          <button className="outline-action" onClick={onLogout}>
            Sign out
          </button>
        }
      />
      <div className="stats-grid">
        <Stat
          label="Active orders"
          value={String(stats.activeOrders)}
          change="Current work"
          icon="↗"
        />
        <Stat
          label="Pending requests"
          value={String(stats.pendingRequests)}
          change="Awaiting response"
          icon="◷"
        />
        <Stat
          label="Completed orders"
          value={String(stats.completedOrders)}
          change="Finished projects"
          icon="✓"
        />
        <Stat
          label="Average rating"
          value={stats.averageRating.toFixed(1)}
          change={`From ${stats.reviewCount} reviews`}
          icon="★"
        />
      </div>
      <section className="panel provider-requests">
        <div className="panel-title">
          <div>
            <span className="kicker">ORDER REQUESTS</span>
            <h2>Client service requests</h2>
          </div>
          <span className="queue-count">
            {
              providerOrders.filter((order) => order.status === "REQUESTED")
                .length
            }{" "}
            awaiting decision
          </span>
        </div>
        {providerOrders.length ? (
          providerOrders.map((order) => (
            <article className="provider-request" key={order.id}>
              <div className="request-main">
                <span
                  className={`listing-status ${order.status.toLowerCase()}`}
                >
                  {order.status.replaceAll("_", " ")}
                </span>
                <small>{order.orderNumber}</small>
                <h3>{order.title}</h3>
                <p>{order.requirements}</p>
                <div className="request-facts">
                  <span>
                    <small>CLIENT</small>
                    <b>{order.client.displayName}</b>
                  </span>
                  <span>
                    <small>PACKAGE</small>
                    <b>{order.package.name}</b>
                  </span>
                  <span>
                    <small>TOTAL</small>
                    <b>₱{(order.totalCentavos / 100).toLocaleString()}</b>
                  </span>
                  <span>
                    <small>DUE</small>
                    <b>{new Date(order.dueAt).toLocaleDateString()}</b>
                  </span>
                </div>
              </div>
              {order.status === "REQUESTED" ? (
                <div className="request-actions">
                  <button
                    className="approve"
                    onClick={() => void decideOrder(order, "accept")}
                  >
                    Accept request
                  </button>
                  <button
                    className="reject"
                    onClick={() => void decideOrder(order, "reject")}
                  >
                    Reject
                  </button>
                  <button
                    className="outline-button"
                    onClick={() => setWorkspaceOrder(order)}
                  >
                    Open workspace
                  </button>
                </div>
              ) : order.status === "ACCEPTED" ? (
                <div className="request-actions">
                  <button
                    className="approve"
                    onClick={() => void startOrder(order)}
                  >
                    Start working
                  </button>
                  <button
                    className="outline-button"
                    onClick={() => setWorkspaceOrder(order)}
                  >
                    Open workspace
                  </button>
                </div>
              ) : (
                <div className="request-actions">
                  <span className="request-decision">
                    {order.status === "IN_PROGRESS"
                      ? "Work in progress · Client notified"
                      : "Decision recorded · Client notified"}
                  </span>
                  <button
                    className="outline-button"
                    onClick={() => setWorkspaceOrder(order)}
                  >
                    Open workspace
                  </button>
                </div>
              )}
            </article>
          ))
        ) : (
          <div className="empty compact">
            <span>◇</span>
            <h3>No service requests yet</h3>
            <p>New client bookings will appear here for your decision.</p>
          </div>
        )}
      </section>
      <div className="provider-setup-grid">
        <section className="panel provider-identity-panel">
          <span className="kicker">PROVIDER IDENTITY</span>
          <h2>
            {profile
              ? "Update your provider profile"
              : "Create your provider profile"}
          </h2>
          <form className="provider-form" onSubmit={saveProfile}>
            <label>
              Professional headline
              <input
                value={profileForm.headline}
                onChange={(event) =>
                  setProfileForm({
                    ...profileForm,
                    headline: event.target.value,
                  })
                }
                minLength={3}
                maxLength={100}
                placeholder="Student graphic designer and illustrator"
                required
              />
            </label>
            <label>
              Provider bio
              <textarea
                value={profileForm.bio}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, bio: event.target.value })
                }
                minLength={20}
                maxLength={1000}
                placeholder="Describe your experience and the value you provide."
                required
              />
            </label>
            <label>
              Skills <small>Separate with commas</small>
              <input
                value={profileForm.skills}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, skills: event.target.value })
                }
                placeholder="Logo design, Canva, Illustration"
                required
              />
            </label>
            <label className="availability-check">
              <input
                type="checkbox"
                checked={profileForm.isAvailable}
                onChange={(event) =>
                  setProfileForm({
                    ...profileForm,
                    isAvailable: event.target.checked,
                  })
                }
              />{" "}
              Available for new orders
            </label>
            <button
              className="primary-button"
              disabled={savingProfile || !profileValid || !profileDirty}
            >
              {savingProfile
                ? "Saving…"
                : profile && !profileDirty
                  ? "Profile saved"
                  : "Save provider profile"}
            </button>
          </form>
          <div className="provider-readiness">
            <div className="provider-readiness-heading">
              <div>
                <span className="kicker">PROFILE READINESS</span>
                <h3>{stats.profileStrength}% complete</h3>
              </div>
              <span
                className={`availability-pill ${profileForm.isAvailable ? "available" : "paused"}`}
              >
                {profileForm.isAvailable ? "Accepting orders" : "Unavailable"}
              </span>
            </div>
            <div
              className="readiness-track"
              aria-label={`Provider profile ${stats.profileStrength}% complete`}
            >
              <span
                style={{
                  width: `${Math.max(0, Math.min(100, stats.profileStrength))}%`,
                }}
              />
            </div>
            <div className="provider-checklist">
              <span className={profile ? "done" : ""}>
                <b>{profile ? "✓" : "1"}</b>
                <small>Complete provider identity</small>
              </span>
              <span className={services.length ? "done" : ""}>
                <b>{services.length ? "✓" : "2"}</b>
                <small>Create your first service</small>
              </span>
              <span
                className={
                  services.some((service) => service.status === "PUBLISHED")
                    ? "done"
                    : ""
                }
              >
                <b>
                  {services.some((service) => service.status === "PUBLISHED")
                    ? "✓"
                    : "3"}
                </b>
                <small>Publish an approved listing</small>
              </span>
            </div>
            <div className="provider-snapshot">
              <span>
                <small>SERVICES</small>
                <b>{services.length}</b>
              </span>
              <span>
                <small>PUBLISHED</small>
                <b>
                  {
                    services.filter((service) => service.status === "PUBLISHED")
                      .length
                  }
                </b>
              </span>
              <span>
                <small>REVIEWS</small>
                <b>{stats.reviewCount}</b>
              </span>
            </div>
            <div className="provider-playbook">
              <span className="kicker">PROVIDER PLAYBOOK</span>
              <h3>Make your first listing stand out</h3>
              <ul>
                <li>
                  <b>Use a clear result-focused title</b>
                  <small>Tell clients exactly what they will receive.</small>
                </li>
                <li>
                  <b>Add a polished cover image</b>
                  <small>
                    Strong visuals help your service earn more clicks.
                  </small>
                </li>
                <li>
                  <b>Set realistic delivery times</b>
                  <small>
                    Leave enough room for school work and revisions.
                  </small>
                </li>
              </ul>
            </div>
          </div>
        </section>
        <section className="panel">
          <span className="kicker">
            {editingServiceId ? "EDIT LISTING" : "NEW LISTING"}
          </span>
          <h2>
            {editingServiceId
              ? "Update service draft"
              : "Create a service draft"}
          </h2>
          {!profile ? (
            <div className="provider-gate">
              Complete your provider profile before creating a listing.
            </div>
          ) : (
            <form className="provider-form" onSubmit={saveService}>
              <label>
                Category
                <select
                  value={serviceForm.categoryId}
                  onChange={(event) =>
                    setServiceForm({
                      ...serviceForm,
                      categoryId: event.target.value,
                    })
                  }
                  required
                >
                  {categories.map((category) => (
                    <option value={category.id} key={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Service title
                <input
                  value={serviceForm.title}
                  onChange={(event) =>
                    setServiceForm({
                      ...serviceForm,
                      title: event.target.value,
                    })
                  }
                  minLength={10}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                Description
                <textarea
                  value={serviceForm.description}
                  onChange={(event) =>
                    setServiceForm({
                      ...serviceForm,
                      description: event.target.value,
                    })
                  }
                  minLength={50}
                  maxLength={3000}
                  required
                />
              </label>
              <div className="provider-form-row">
                <label>
                  Delivery
                  <select
                    value={serviceForm.deliveryMethod}
                    onChange={(event) =>
                      setServiceForm({
                        ...serviceForm,
                        deliveryMethod: event.target.value,
                      })
                    }
                  >
                    <option value="ONLINE">Online</option>
                    <option value="IN_PERSON">In person</option>
                    <option value="HYBRID">Hybrid</option>
                  </select>
                </label>
                <label>
                  Campus location <small>Optional</small>
                  <input
                    value={serviceForm.campusLocation}
                    onChange={(event) =>
                      setServiceForm({
                        ...serviceForm,
                        campusLocation: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <div className="package-stack">
                {serviceForm.packages.map((item) => (
                  <div
                    className={`package-editor ${item.enabled ? "" : "disabled"}`}
                    key={item.tier}
                  >
                    <label className="package-toggle">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        disabled={item.tier === "BASIC"}
                        onChange={(event) =>
                          updatePackage(item.tier, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                      <b>
                        {item.tier[0] + item.tier.slice(1).toLowerCase()}{" "}
                        package
                      </b>
                      {item.tier === "BASIC" ? (
                        <small>Required</small>
                      ) : (
                        <small>Optional</small>
                      )}
                    </label>
                    {item.enabled && (
                      <>
                        <label>
                          Package name
                          <input
                            value={item.name}
                            onChange={(event) =>
                              updatePackage(item.tier, {
                                name: event.target.value,
                              })
                            }
                            required
                          />
                        </label>
                        <label>
                          What is included?
                          <textarea
                            value={item.description}
                            onChange={(event) =>
                              updatePackage(item.tier, {
                                description: event.target.value,
                              })
                            }
                            minLength={10}
                            required
                          />
                        </label>
                        <div className="provider-form-row three">
                          <label>
                            Price (₱)
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={item.pricePesos}
                              onChange={(event) =>
                                updatePackage(item.tier, {
                                  pricePesos: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label>
                            Delivery days
                            <input
                              type="number"
                              min="1"
                              max="90"
                              value={item.deliveryDays}
                              onChange={(event) =>
                                updatePackage(item.tier, {
                                  deliveryDays: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label>
                            Revisions
                            <input
                              type="number"
                              min="0"
                              max="20"
                              value={item.revisionLimit}
                              onChange={(event) =>
                                updatePackage(item.tier, {
                                  revisionLimit: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="service-form-actions">
                <button
                  className="primary-button"
                  disabled={savingService || !serviceValid || !serviceDirty}
                >
                  {savingService
                    ? "Saving…"
                    : editingServiceId && !serviceDirty
                      ? "Changes saved"
                      : editingServiceId
                        ? "Save changes"
                        : "Create draft"}
                </button>
                {editingServiceId && (
                  <button
                    type="button"
                    className="outline-button"
                    onClick={resetServiceForm}
                  >
                    Cancel editing
                  </button>
                )}
              </div>
            </form>
          )}
        </section>
      </div>
      <section className="panel provider-services-panel">
        <div className="panel-title">
          <div>
            <span className="kicker">YOUR SERVICES</span>
            <h2>Listings, packages, and media</h2>
          </div>
          <span className="queue-count">
            {services.length} service{services.length === 1 ? "" : "s"}
          </span>
        </div>
        {services.length ? (
          services.map((service) => (
            <div className="service-listing-block" key={service.id}>
              <div className="provider-service-row">
                <div>
                  <b>{service.title}</b>
                  <small>
                    {service.category.name} · {service.packages.length} package
                    {service.packages.length === 1 ? "" : "s"} ·{" "}
                    {service.media?.length ?? 0} media file
                    {service.media?.length === 1 ? "" : "s"}
                  </small>
                  {service.status === "REJECTED" && service.rejectionReason ? (
                    <small className="rejection-copy">
                      Admin feedback: {service.rejectionReason}
                    </small>
                  ) : null}
                </div>
                <span
                  className={`listing-status ${service.status.toLowerCase().replace("_", "-")}`}
                >
                  {service.status.replace("_", " ")}
                </span>
                <strong>
                  ₱{Math.round((service.packages[0]?.priceCentavos ?? 0) / 100)}
                </strong>
                {service.status === "DRAFT" || service.status === "REJECTED" ? (
                  <div className="listing-actions">
                    <button
                      className="outline-button"
                      onClick={() => editService(service)}
                    >
                      Edit
                    </button>
                    <button
                      className="approve"
                      onClick={() => submitService(service)}
                    >
                      Submit for review
                    </button>
                  </div>
                ) : (
                  <span className="moderation-note">
                    {service.status === "PUBLISHED"
                      ? "Visible in marketplace"
                      : "Awaiting admin action"}
                  </span>
                )}
              </div>
              {(service.status === "DRAFT" ||
                service.status === "REJECTED") && (
                <div className="service-media-editor">
                  <div className="media-file-list">
                    {service.media?.map((media) => (
                      <span key={media.id}>
                        <b>{media.kind === "COVER" ? "Cover" : "Portfolio"}</b>
                        {media.originalName}
                        <button
                          onClick={() => removeMedia(service, media.id)}
                          aria-label={`Remove ${media.originalName}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {!service.media?.length && (
                      <small>
                        No media uploaded yet. Files stay private until
                        publication.
                      </small>
                    )}
                  </div>
                  <div className="media-upload-grid">
                    <label>
                      Cover image <small>JPG, PNG, or WebP</small>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) =>
                          setMediaDrafts((value) => ({
                            ...value,
                            [service.id]: {
                              cover: event.target.files?.[0] ?? null,
                              portfolio: value[service.id]?.portfolio ?? [],
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Portfolio <small>Up to 5 images or PDFs</small>
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={(event) =>
                          setMediaDrafts((value) => ({
                            ...value,
                            [service.id]: {
                              cover: value[service.id]?.cover ?? null,
                              portfolio: Array.from(event.target.files ?? []),
                            },
                          }))
                        }
                      />
                    </label>
                    <button
                      className="outline-button"
                      disabled={uploadingMediaId === service.id}
                      onClick={() => uploadMedia(service)}
                    >
                      {uploadingMediaId === service.id
                        ? "Uploading…"
                        : "Upload media"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="empty compact">
            <span>◇</span>
            <h3>No service drafts</h3>
            <p>Your real listings will appear here after creation.</p>
          </div>
        )}
      </section>
      {workspaceOrder && (
        <WebOrderWorkspace
          token={token}
          order={workspaceOrder}
          onClose={() => setWorkspaceOrder(null)}
          onChanged={refresh}
        />
      )}
    </main>
  );
}
