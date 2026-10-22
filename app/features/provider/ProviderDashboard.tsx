"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io } from "socket.io-client";
import { realtimeSocketEnabled } from "../realtime/realtime-config";
import { createPortal } from "react-dom";
import { DashboardHeader, Stat } from "../../components/dashboard";
import { useAppDialog } from "../../components/app-dialog";
import { api } from "../../lib/api";
import { apiUrl } from "../../lib/http-client";
import { SkeletonCollection } from "../../components/Skeletons";
import { formatMarketplaceStatus } from "../../lib/marketplace-presentation";
import { WebOrderWorkspace } from "../orders/WebOrderWorkspace";
import type {
  AuthUser,
  Category,
  MarketplaceOrder,
  ProviderProfile,
  ProviderEarning,
  ProviderEarningsSummary,
  PayoutDestination,
  ProviderPayout,
  ProviderService,
  ProviderStats,
  RushTier,
} from "../../types";
import { formatCampusDate } from "../../lib/date";
import {
  emptyProviderProfileDraft,
  isProviderProfileDraftDirty,
  reconcileProviderProfileRefresh,
  type ProviderProfileDraft,
} from "./provider-profile-draft";
import {
  getCharacterProgress,
  serviceFieldLimits,
} from "./service-field-validation";
import { LatestRequestGate } from "./latest-request-gate";
import {
  formatDeliveryMinutes,
  isLegacyServicePricingModel,
  isSinglePriceV2ServicePricingModel,
} from "../../lib/pricing-model";
import {
  providerServiceActions,
  providerServiceStatusCopy,
  type ProviderServiceAction,
} from "./service-lifecycle";

const providerRequestsPerPage = 5;
const earningsBuckets = [
  ["Pending", "pendingCentavos"],
  ["Available", "availableCentavos"],
  ["Withdrawable", "withdrawableCentavos"],
  ["Frozen", "frozenCentavos"],
  ["Payout Processing", "payoutProcessingCentavos"],
  ["Paid Out", "paidOutCentavos"],
  ["Refunded", "refundedCentavos"],
] as const;

function formatEarningAmount(amountCentavos: number, currency: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
  }).format(amountCentavos / 100);
}
const rushTierOptions: { value: RushTier; label: string; minutes: number }[] = [
  { value: "HOURS_24", label: "24 hours", minutes: 1440 },
  { value: "HOURS_12", label: "12 hours", minutes: 720 },
  { value: "HOURS_6", label: "6 hours", minutes: 360 },
  { value: "HOURS_3", label: "3 hours", minutes: 180 },
];

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
  const appDialog = useAppDialog();
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
    maxActiveOrders: 5,
    maxPendingOrders: 50,
    acceptingOrders: false,
  });
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [providerOrders, setProviderOrders] = useState<MarketplaceOrder[]>([]);
  const [providerOrdersNextCursor, setProviderOrdersNextCursor] = useState<
    string | null
  >(null);
  const [providerOrdersHaveMore, setProviderOrdersHaveMore] = useState(false);
  const [providerOrdersLoadingMore, setProviderOrdersLoadingMore] =
    useState(false);
  const [earningsSummary, setEarningsSummary] = useState<
    ProviderEarningsSummary[]
  >([]);
  const [earnings, setEarnings] = useState<ProviderEarning[]>([]);
  const [earningsNextCursor, setEarningsNextCursor] = useState<string | null>(
    null,
  );
  const [earningsHaveMore, setEarningsHaveMore] = useState(false);
  const [earningsLoadingMore, setEarningsLoadingMore] = useState(false);
  const [payoutDestinations, setPayoutDestinations] = useState<
    PayoutDestination[]
  >([]);
  const [payouts, setPayouts] = useState<ProviderPayout[]>([]);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [destinationForm, setDestinationForm] = useState({
    type: "E_WALLET" as PayoutDestination["type"],
    displayLabel: "",
    accountIdentifier: "",
    accountHolderName: "",
  });
  const providerOrderPagesLoadedRef = useRef(1);
  const [requestPage, setRequestPage] = useState(1);
  const [workspaceOrder, setWorkspaceOrder] = useState<MarketplaceOrder | null>(
    null,
  );
  const [profileForm, setProfileForm] = useState<ProviderProfileDraft>(
    emptyProviderProfileDraft,
  );
  const [hasPendingRemoteProfile, setHasPendingRemoteProfile] = useState(false);
  const [reloadingProfile, setReloadingProfile] = useState(false);
  const profileInitializedRef = useRef(false);
  const activityRequestGateRef = useRef(new LatestRequestGate());
  const profileEditorRef = useRef({ profile, profileForm });
  profileEditorRef.current = { profile, profileForm };
  const [serviceForm, setServiceForm] = useState({
    categoryId: categories[0]?.id ?? "",
    title: "",
    description: "",
    deliveryMethod: "ONLINE",
    campusLocation: "",
    pricingModel: "LEGACY_PACKAGES" as "LEGACY_PACKAGES" | "SINGLE_PRICE_V2",
    basePricePesos: "",
    normalDeliveryDays: "3",
    includedRevisionLimit: "1",
    acceptsRushOrders: false,
    fastestRushTier: "HOURS_12" as RushTier,
    packages: blankPackages(),
  });
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [mediaDrafts, setMediaDrafts] = useState<
    Record<string, { cover: File | null; portfolio: File[] }>
  >({});
  const [uploadingMediaId, setUploadingMediaId] = useState<string | null>(null);
  const [previewService, setPreviewService] = useState<ProviderService | null>(
    null,
  );
  const previewCloseRef = useRef<HTMLButtonElement>(null);
  const [serviceAction, setServiceAction] = useState<{
    id: string;
    action: ProviderServiceAction;
  } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingService, setSavingService] = useState(false);
  const requestPageCount = Math.max(
    1,
    Math.ceil(providerOrders.length / providerRequestsPerPage),
  );
  const paginatedProviderOrders = useMemo(
    () =>
      providerOrders.slice(
        (requestPage - 1) * providerRequestsPerPage,
        requestPage * providerRequestsPerPage,
      ),
    [providerOrders, requestPage],
  );
  const hasCompleteProviderIdentity = Boolean(
    profile?.headline.trim() &&
      profile.bio.trim() &&
      profile.skills.some((skill) => skill.trim().length > 0),
  );
  const isFullyVerifiedProvider =
    stats.verified === true && stats.profileStrength >= 100;

  const applyRemoteProfile = useCallback(
    (incomingProfile: ProviderProfile | null, force = false) => {
      const current = profileEditorRef.current;
      const result = reconcileProviderProfileRefresh({
        savedProfile: current.profile,
        draft: current.profileForm,
        incomingProfile,
        initialized: profileInitializedRef.current,
        force,
      });

      if (result.kind === "preserve") {
        setHasPendingRemoteProfile(true);
        return;
      }

      profileInitializedRef.current = true;
      profileEditorRef.current = {
        profile: result.profile,
        profileForm: result.draft,
      };
      setProfile(result.profile);
      setProfileForm(result.draft);
      setHasPendingRemoteProfile(false);
    },
    [],
  );

  const fetchProviderOrderPages = useCallback(async () => {
    const refreshed: MarketplaceOrder[] = [];
    let cursor: string | undefined;
    let result = await api.providerOrders(token);
    let page = 0;
    while (true) {
      refreshed.push(...result.data);
      page += 1;
      if (
        !result.pagination.hasMore ||
        page >= providerOrderPagesLoadedRef.current
      )
        break;
      cursor = result.pagination.nextCursor ?? undefined;
      if (!cursor) break;
      result = await api.providerOrders(token, cursor);
    }
    return {
      orders: Array.from(
        new Map(refreshed.map((order) => [order.id, order])).values(),
      ),
      nextCursor: result.pagination.nextCursor,
      hasMore: result.pagination.hasMore,
    };
  }, [token]);

  const refresh = useCallback(async () => {
    const activityRequestId = activityRequestGateRef.current.begin();
    try {
      const [
        nextStats,
        profileResult,
        nextServices,
        nextOrders,
        nextEarningsSummary,
        nextEarnings,
      ] = await Promise.all([
        api.providerStats(token),
        api.providerProfile(token),
        api.providerServices(token),
        fetchProviderOrderPages(),
        api.providerEarningsSummary(token),
        api.providerEarnings(token),
      ]);
      if (activityRequestGateRef.current.isLatest(activityRequestId)) {
        setStats(nextStats);
        setProviderOrders(nextOrders.orders);
        setProviderOrdersNextCursor(nextOrders.nextCursor);
        setProviderOrdersHaveMore(nextOrders.hasMore);
        setEarningsSummary(nextEarningsSummary.data);
        setEarnings(nextEarnings.data);
        setEarningsNextCursor(nextEarnings.pagination.nextCursor);
        setEarningsHaveMore(nextEarnings.pagination.hasMore);
      }
      setServices(nextServices);
      applyRemoteProfile(profileResult.data);
    } catch {
      notify("Unable to load provider workspace");
    } finally {
      setWorkspaceLoading(false);
    }
  }, [applyRemoteProfile, fetchProviderOrderPages, notify, token]);
  const refreshActivity = useCallback(async () => {
    const activityRequestId = activityRequestGateRef.current.begin();
    try {
      const [nextStats, nextOrders, nextEarningsSummary, nextEarnings] =
        await Promise.all([
          api.providerStats(token),
          fetchProviderOrderPages(),
          api.providerEarningsSummary(token),
          api.providerEarnings(token),
        ]);
      if (activityRequestGateRef.current.isLatest(activityRequestId)) {
        setStats(nextStats);
        setProviderOrders(nextOrders.orders);
        setProviderOrdersNextCursor(nextOrders.nextCursor);
        setProviderOrdersHaveMore(nextOrders.hasMore);
        setEarningsSummary(nextEarningsSummary.data);
        setEarnings(nextEarnings.data);
        setEarningsNextCursor(nextEarnings.pagination.nextCursor);
        setEarningsHaveMore(nextEarnings.pagination.hasMore);
      }
    } catch {
      // The next realtime event, visibility refresh, or fallback refresh retries.
    }
  }, [fetchProviderOrderPages, token]);

  const loadMoreProviderOrders = useCallback(async () => {
    if (!providerOrdersNextCursor || providerOrdersLoadingMore) return;
    setProviderOrdersLoadingMore(true);
    try {
      const result = await api.providerOrders(token, providerOrdersNextCursor);
      setProviderOrders((current) =>
        Array.from(
          new Map(
            [...current, ...result.data].map((order) => [order.id, order]),
          ).values(),
        ),
      );
      providerOrderPagesLoadedRef.current += 1;
      setProviderOrdersNextCursor(result.pagination.nextCursor);
      setProviderOrdersHaveMore(result.pagination.hasMore);
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to load more orders",
      );
    } finally {
      setProviderOrdersLoadingMore(false);
    }
  }, [notify, providerOrdersLoadingMore, providerOrdersNextCursor, token]);
  const loadMoreEarnings = useCallback(async () => {
    if (!earningsNextCursor || earningsLoadingMore) return;
    setEarningsLoadingMore(true);
    try {
      const result = await api.providerEarnings(token, earningsNextCursor);
      setEarnings((current) => [
        ...current,
        ...result.data.filter(
          (earning) => !current.some((item) => item.id === earning.id),
        ),
      ]);
      setEarningsNextCursor(result.pagination.nextCursor);
      setEarningsHaveMore(result.pagination.hasMore);
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to load more earnings",
      );
    } finally {
      setEarningsLoadingMore(false);
    }
  }, [earningsLoadingMore, earningsNextCursor, notify, token]);
  const refreshPayouts = useCallback(async () => {
    const [destinations, history] = await Promise.all([
      api.providerPayoutDestinations(token),
      api.providerPayouts(token),
    ]);
    setPayoutDestinations(destinations.data);
    setPayouts(history.data);
  }, [token]);
  useEffect(() => {
    void refreshPayouts().catch(() => notify("Unable to load payout controls"));
  }, [notify, refreshPayouts]);

  async function addPayoutDestination(event: FormEvent) {
    event.preventDefault();
    setPayoutBusy(true);
    try {
      await api.createProviderPayoutDestination(token, destinationForm);
      setDestinationForm({
        type: "E_WALLET",
        displayLabel: "",
        accountIdentifier: "",
        accountHolderName: "",
      });
      await refreshPayouts();
      notify("Payout destination saved for administrator review");
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to save destination",
      );
    } finally {
      setPayoutBusy(false);
    }
  }

  async function requestPayout(currency: string) {
    const destination = payoutDestinations.find(
      (item) =>
        item.isActive &&
        ["ADMIN_REVIEWED", "PROVIDER_VERIFIED"].includes(
          item.verificationStatus,
        ),
    );
    if (!destination) {
      notify("An active administrator-reviewed destination is required");
      return;
    }
    if (
      !(await appDialog.confirm({
        title: `Withdraw all eligible ${currency} earnings?`,
        message: `CampusGig will reserve every currently withdrawable ${currency} earning for ${destination.displayLabel} ${destination.maskedAccountIdentifier}. The payout fee is zero. This request does not send money.`,
        confirmLabel: "Request payout",
      }))
    )
      return;
    setPayoutBusy(true);
    try {
      await api.requestProviderPayout(token, {
        destinationId: destination.id,
        currency,
        clientRequestId: crypto.randomUUID(),
      });
      await Promise.all([refreshActivity(), refreshPayouts()]);
      notify("Payout requested; no money has been sent yet");
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to request payout",
      );
    } finally {
      setPayoutBusy(false);
    }
  }

  async function cancelPayout(payout: ProviderPayout) {
    if (
      !(await appDialog.confirm({
        title: "Cancel payout request?",
        message:
          "The reserved earnings will return to Available with their original 24-hour eligibility timestamps.",
        confirmLabel: "Cancel request",
        tone: "danger",
      }))
    )
      return;
    setPayoutBusy(true);
    try {
      await api.cancelProviderPayout(token, payout.id);
      await Promise.all([refreshActivity(), refreshPayouts()]);
      notify("Payout request cancelled");
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to cancel payout",
      );
    } finally {
      setPayoutBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const endpoint = apiUrl();
    if (!endpoint) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const refreshWhenFocused = () => void refresh();
    const socket = realtimeSocketEnabled()
      ? io(`${new URL(endpoint).origin}/realtime`, {
          auth: { token },
          transports: ["websocket", "polling"],
          reconnection: true,
        })
      : null;
    socket?.on("connect", () => {
      socket.emit("provider:subscribe", { providerId: user.id });
      void refresh();
    });
    socket?.on("order:changed", () => void refreshActivity());
    socket?.on("payment:changed", () => void refreshActivity());
    socket?.on("provider:stats-changed", (event: { providerId?: string }) => {
      if (event.providerId === user.id) void refreshActivity();
    });
    socket?.on("provider:profile-changed", (event: { providerId?: string }) => {
      if (event.providerId === user.id) void refresh();
    });
    socket?.on("provider:services-changed", (event: { providerId?: string }) => {
      if (event.providerId === user.id) void refresh();
    });
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenFocused);
    const fallback = window.setInterval(() => void refreshActivity(), 10000);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenFocused);
      window.clearInterval(fallback);
      socket?.disconnect();
    };
  }, [refresh, refreshActivity, token, user.id]);
  useEffect(() => {
    if (!openOrderId || !providerOrders.length) return;
    const target = providerOrders.find((order) => order.id === openOrderId);
    if (target) {
      setWorkspaceOrder(target);
      onOrderOpened?.();
    }
  }, [onOrderOpened, openOrderId, providerOrders]);
  useEffect(() => {
    if (!serviceForm.categoryId && categories[0])
      setServiceForm((value) => ({ ...value, categoryId: categories[0].id }));
  }, [categories, serviceForm.categoryId]);
  useEffect(() => {
    setRequestPage((current) => Math.min(current, requestPageCount));
  }, [requestPageCount]);
  useEffect(() => {
    if (!previewService) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      previewCloseRef.current?.focus(),
    );
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewService(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [previewService]);

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
        maxActiveOrders: profileForm.maxActiveOrders,
        maxPendingOrders: profileForm.maxPendingOrders,
        instagramUrl: profileForm.instagramUrl.trim() || null,
        linkedinUrl: profileForm.linkedinUrl.trim() || null,
        xUrl: profileForm.xUrl.trim() || null,
        portfolioUrl: profileForm.portfolioUrl.trim() || null,
      });
      applyRemoteProfile(result.data, true);
      notify("Provider profile saved");
      await refreshActivity();
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
  async function reloadLatestProfile() {
    const confirmed = await appDialog.confirm({
      title: "Reload latest profile?",
      message:
        "Your unsaved profile edits will be replaced with the latest version from CampusGig.",
      confirmLabel: "Reload profile",
      cancelLabel: "Keep editing",
    });
    if (!confirmed) return;

    setReloadingProfile(true);
    try {
      const result = await api.providerProfile(token);
      applyRemoteProfile(result.data, true);
      notify("Latest provider profile loaded");
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to reload the latest provider profile",
      );
    } finally {
      setReloadingProfile(false);
    }
  }
  function servicePayload() {
    const common = {
      categoryId: serviceForm.categoryId,
      title: serviceForm.title,
      description: serviceForm.description,
      deliveryMethod: serviceForm.deliveryMethod,
      campusLocation: serviceForm.campusLocation || undefined,
      pricingModel: serviceForm.pricingModel,
    };
    return serviceForm.pricingModel === "SINGLE_PRICE_V2"
      ? {
          ...common,
          basePriceCentavos: Math.round(
            Number(serviceForm.basePricePesos) * 100,
          ),
          normalDeliveryMinutes: Number(serviceForm.normalDeliveryDays) * 1440,
          includedRevisionLimit: Number(serviceForm.includedRevisionLimit),
          acceptsRushOrders: serviceForm.acceptsRushOrders,
          fastestRushTier: serviceForm.acceptsRushOrders
            ? serviceForm.fastestRushTier
            : undefined,
        }
      : {
          ...common,
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
    normalizedSkills.length > 0 &&
    Number.isInteger(profileForm.maxActiveOrders) &&
    profileForm.maxActiveOrders >= 1 &&
    profileForm.maxActiveOrders <= 20 &&
    Number.isInteger(profileForm.maxPendingOrders) &&
    profileForm.maxPendingOrders >= 1 &&
    profileForm.maxPendingOrders <= 100;
  const profileDirty = isProviderProfileDraftDirty(profile, profileForm);
  const enabledPackages = serviceForm.packages.filter((item) => item.enabled);
  const titleProgress = getCharacterProgress(
    serviceForm.title,
    serviceFieldLimits.title,
  );
  const descriptionProgress = getCharacterProgress(
    serviceForm.description,
    serviceFieldLimits.description,
  );
  const commonServiceValid = Boolean(
    serviceForm.categoryId && titleProgress.ready && descriptionProgress.ready,
  );
  const serviceValid = Boolean(
    commonServiceValid &&
      (serviceForm.pricingModel === "SINGLE_PRICE_V2"
        ? Number(serviceForm.basePricePesos) >= 1 &&
          Number(serviceForm.basePricePesos) <= 100000 &&
          Number.isInteger(Number(serviceForm.normalDeliveryDays)) &&
          Number(serviceForm.normalDeliveryDays) >= 1 &&
          Number(serviceForm.normalDeliveryDays) <= 90 &&
          Number.isInteger(Number(serviceForm.includedRevisionLimit)) &&
          Number(serviceForm.includedRevisionLimit) >= 0 &&
          Number(serviceForm.includedRevisionLimit) <= 20 &&
          (!serviceForm.acceptsRushOrders ||
            rushTierOptions.some(
              (item) =>
                item.value === serviceForm.fastestRushTier &&
                item.minutes < Number(serviceForm.normalDeliveryDays) * 1440,
            ))
        : enabledPackages.length > 0 &&
          enabledPackages.every(
            (item) =>
              item.name.trim() &&
              item.description.trim().length >= 10 &&
              Number(item.pricePesos) > 0 &&
              Number(item.deliveryDays) > 0 &&
              Number(item.revisionLimit) >= 0,
          )),
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
        pricingModel: editingService.pricingModel ?? "LEGACY_PACKAGES",
        ...(isSinglePriceV2ServicePricingModel(editingService.pricingModel)
          ? {
              basePriceCentavos: editingService.basePriceCentavos,
              normalDeliveryMinutes: editingService.normalDeliveryMinutes,
              includedRevisionLimit: editingService.includedRevisionLimit,
            }
          : {
              packages: editingService.packages.map((item) => ({
                tier: item.tier,
                name: item.name,
                description: item.description,
                priceCentavos: item.priceCentavos,
                deliveryDays: item.deliveryDays,
                revisionLimit: item.revisionLimit,
              })),
            }),
      });
  function resetServiceForm() {
    setEditingServiceId(null);
    setServiceForm({
      categoryId: categories[0]?.id ?? "",
      title: "",
      description: "",
      deliveryMethod: "ONLINE",
      campusLocation: "",
      pricingModel: "LEGACY_PACKAGES",
      basePricePesos: "",
      normalDeliveryDays: "3",
      includedRevisionLimit: "1",
      acceptsRushOrders: false,
      fastestRushTier: "HOURS_12",
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
      pricingModel: isSinglePriceV2ServicePricingModel(service.pricingModel)
        ? "SINGLE_PRICE_V2"
        : "LEGACY_PACKAGES",
      basePricePesos:
        service.basePriceCentavos == null
          ? ""
          : String(service.basePriceCentavos / 100),
      normalDeliveryDays:
        service.normalDeliveryMinutes == null
          ? "3"
          : String(service.normalDeliveryMinutes / 1440),
      includedRevisionLimit: String(service.includedRevisionLimit ?? 1),
      acceptsRushOrders: service.acceptsRushOrders ?? false,
      fastestRushTier: service.fastestRushTier ?? "HOURS_12",
      packages,
    });
    window.scrollTo({ top: 430, behavior: "smooth" });
  }
  async function beginEditingService(service: ProviderService) {
    if (service.status !== "PUBLISHED" && service.status !== "PAUSED") {
      editService(service);
      return;
    }
    if (
      !(await appDialog.confirm({
        title: "Edit this approved listing?",
        message:
          "The listing will become a private draft and disappear from Discover until an administrator approves it again. Existing orders will not change.",
        confirmLabel: "Create private draft",
      }))
    )
      return;

    setServiceAction({ id: service.id, action: "edit" });
    try {
      const result = await api.reviseProviderService(token, service.id);
      setServices((items) =>
        items.map((item) => (item.id === service.id ? result.data : item)),
      );
      if (previewService?.id === service.id) setPreviewService(null);
      editService(result.data);
      notify(result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to edit listing");
      await refresh();
    } finally {
      setServiceAction(null);
    }
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

  async function transitionService(
    service: ProviderService,
    action: "pause" | "resume" | "archive" | "restore",
  ) {
    if (
      action === "archive" &&
      !(await appDialog.confirm({
        title: "Archive this listing?",
        message:
          "Clients will no longer see it. You can restore it later, and it will return in a paused state.",
        confirmLabel: "Archive listing",
        tone: "danger",
      }))
    )
      return;

    setServiceAction({ id: service.id, action });
    try {
      const result = await api.transitionProviderService(
        token,
        service.id,
        action,
      );
      setServices((items) =>
        items.map((item) => (item.id === service.id ? result.data : item)),
      );
      if (previewService?.id === service.id) setPreviewService(result.data);
      notify(result.message);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Unable to update listing",
      );
      await refresh();
    } finally {
      setServiceAction(null);
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
    if (
      !(await appDialog.confirm({
        title: "Remove this media?",
        message:
          "The file will be removed from this service and will no longer appear to clients.",
        confirmLabel: "Remove media",
        cancelLabel: "Keep media",
        tone: "danger",
      }))
    )
      return;
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
        ? await appDialog.prompt({
            title: "Reject this request?",
            message:
              "Briefly explain why you cannot accept it. The client will receive your reason.",
            placeholder: "Explain why you are declining this request…",
            minLength: 3,
            maxLength: 500,
            validationMessage: "Enter at least 3 characters.",
            confirmLabel: "Reject request",
            cancelLabel: "Keep request",
            tone: "danger",
          })
        : "";
    if (decision === "reject" && !reason) return;
    if (
      decision === "accept" &&
      !(await appDialog.confirm({
        title: "Accept this request?",
        message: order.dueAt
          ? `You are committing to deliver ${order.title} by ${formatCampusDate(order.dueAt)}.`
          : `You are accepting ${order.title}. Its exact deadline starts after successful payment confirmation.`,
        confirmLabel: "Accept request",
        cancelLabel: "Review again",
      }))
    )
      return;
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
    if (
      !(await appDialog.confirm({
        title: "Start working on this order?",
        message:
          "The client will be notified and the project status will change to in progress.",
        confirmLabel: "Start working",
        cancelLabel: "Not yet",
      }))
    )
      return;
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

  if (workspaceLoading)
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
        <SkeletonCollection
          kind="admin"
          count={4}
          label="Loading provider workspace"
        />
      </main>
    );

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
      <section
        className="panel provider-earnings"
        aria-labelledby="earnings-title"
      >
        <div className="panel-title">
          <div>
            <span className="kicker">EARNINGS &amp; PAYOUTS</span>
            <h2 id="earnings-title">Provider Earnings and Payouts</h2>
          </div>
          <span className="earnings-read-only">Server-authoritative</span>
        </div>
        <p className="earnings-explanation">
          Available earnings become withdrawable exactly 24 hours after their
          server-recorded availability time, provided no dispute, refund, or
          payout reservation blocks them. Withdrawable is a subset of Available,
          not additional earnings.
        </p>
        {earningsSummary.length ? (
          earningsSummary.map((summary) => (
            <div className="earnings-currency" key={summary.currency}>
              <h3>{summary.currency}</h3>
              <div className="earnings-summary-grid">
                {earningsBuckets.map(([label, field]) => (
                  <article key={field}>
                    <small>{label}</small>
                    <b>
                      {formatEarningAmount(summary[field], summary.currency)}
                    </b>
                  </article>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="earnings-zero-summary" role="status">
            No paid-order earnings have been recorded yet.
          </div>
        )}
        <div className="earnings-history">
          <h3>Earnings history</h3>
          {earnings.length ? (
            earnings.map((earning) => (
              <article className="earning-row" key={earning.id}>
                <div>
                  <small>{earning.orderNumber}</small>
                  <b>{earning.serviceTitle}</b>
                  <span>
                    {earning.sourceType === "PAID_EXTRA_REVISION"
                      ? `Paid extra revision${earning.revisionSequence ? ` #${earning.revisionSequence}` : ""}`
                      : "Original order earning"}
                  </span>
                  <time>{formatCampusDate(earning.pendingAt)}</time>
                </div>
                <div>
                  <b>
                    {formatEarningAmount(
                      earning.amountCentavos,
                      earning.currency,
                    )}
                  </b>
                  <span>{formatMarketplaceStatus(earning.status)}</span>
                  {earning.status === "AVAILABLE" &&
                    earning.withdrawalEligibleAt && (
                      <small>
                        {earning.isWithdrawable
                          ? "Withdrawable now"
                          : `Eligible ${formatCampusDate(earning.withdrawalEligibleAt)}`}
                      </small>
                    )}
                </div>
              </article>
            ))
          ) : (
            <div className="empty compact earnings-empty">
              <span>◇</span>
              <h3>No earnings history</h3>
              <p>Paid orders will appear here after payment confirmation.</p>
            </div>
          )}
          {earningsHaveMore && (
            <button
              type="button"
              className="outline-action"
              disabled={earningsLoadingMore}
              onClick={() => void loadMoreEarnings()}
            >
              {earningsLoadingMore
                ? "Loading earnings..."
                : "Load more earnings"}
            </button>
          )}
        </div>
        <div className="earnings-history payout-controls">
          <h3>Payout destinations</h3>
          <p className="earnings-explanation">
            CampusGig stores only the masked identifier below. New destinations
            remain unavailable for payouts until an administrator reviews them.
          </p>
          {payoutDestinations.map((destination) => (
            <article className="earning-row" key={destination.id}>
              <div>
                <b>{destination.displayLabel}</b>
                <span>{destination.maskedAccountIdentifier}</span>
                <small>{destination.accountHolderName}</small>
              </div>
              <div>
                <span>
                  {formatMarketplaceStatus(destination.verificationStatus)}
                </span>
                <small>{destination.isActive ? "Active" : "Inactive"}</small>
                {destination.isActive && (
                  <button
                    type="button"
                    className="outline-action"
                    disabled={payoutBusy}
                    onClick={() =>
                      void api
                        .deactivateProviderPayoutDestination(
                          token,
                          destination.id,
                        )
                        .then(refreshPayouts)
                        .catch((caught: unknown) =>
                          notify(
                            caught instanceof Error
                              ? caught.message
                              : "Unable to deactivate destination",
                          ),
                        )
                    }
                  >
                    Deactivate
                  </button>
                )}
              </div>
            </article>
          ))}
          <form className="auth-form" onSubmit={addPayoutDestination}>
            <label>
              Destination type
              <select
                value={destinationForm.type}
                onChange={(event) =>
                  setDestinationForm((current) => ({
                    ...current,
                    type: event.target.value as PayoutDestination["type"],
                  }))
                }
              >
                <option value="E_WALLET">E-wallet</option>
                <option value="BANK_ACCOUNT">Bank account</option>
              </select>
            </label>
            <label>
              Display label
              <input
                required
                minLength={2}
                maxLength={80}
                value={destinationForm.displayLabel}
                onChange={(event) =>
                  setDestinationForm((current) => ({
                    ...current,
                    displayLabel: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Account identifier
              <input
                required
                minLength={4}
                maxLength={80}
                autoComplete="off"
                value={destinationForm.accountIdentifier}
                onChange={(event) =>
                  setDestinationForm((current) => ({
                    ...current,
                    accountIdentifier: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Account holder name
              <input
                required
                minLength={2}
                maxLength={120}
                value={destinationForm.accountHolderName}
                onChange={(event) =>
                  setDestinationForm((current) => ({
                    ...current,
                    accountHolderName: event.target.value,
                  }))
                }
              />
            </label>
            <button className="primary-button" disabled={payoutBusy}>
              Add masked destination
            </button>
          </form>
          <h3>Payout request</h3>
          {earningsSummary.map((summary) => (
            <div className="earning-row" key={`payout-${summary.currency}`}>
              <div>
                <b>{summary.currency}</b>
                <span>
                  {formatEarningAmount(
                    summary.withdrawableCentavos,
                    summary.currency,
                  )}{" "}
                  withdrawable
                </span>
                <small>
                  Payout fee: {formatEarningAmount(0, summary.currency)}
                </small>
              </div>
              <button
                type="button"
                className="primary-button"
                disabled={payoutBusy || summary.withdrawableCentavos <= 0}
                onClick={() => void requestPayout(summary.currency)}
              >
                Withdraw all eligible earnings
              </button>
            </div>
          ))}
          <h3>Payout history</h3>
          {payouts.length ? (
            payouts.map((payout) => (
              <article className="earning-row" key={payout.id}>
                <div>
                  <b>
                    {formatEarningAmount(
                      payout.requestedPrincipalCentavos,
                      payout.currency,
                    )}
                  </b>
                  <span>
                    Fee{" "}
                    {formatEarningAmount(
                      payout.payoutFeeCentavos,
                      payout.currency,
                    )}{" "}
                    · Net{" "}
                    {formatEarningAmount(
                      payout.netDisbursementCentavos,
                      payout.currency,
                    )}
                  </span>
                  <small>
                    {payout.destinationSnapshot.displayLabel}{" "}
                    {payout.destinationSnapshot.maskedAccountIdentifier}
                  </small>
                  <time>{formatCampusDate(payout.requestedAt)}</time>
                </div>
                <div>
                  <b>{formatMarketplaceStatus(payout.status)}</b>
                  <small>
                    {payout.status === "PAID"
                      ? "Settlement evidence recorded"
                      : "No payment is implied by this status"}
                  </small>
                  {payout.status === "REQUESTED" && (
                    <button
                      type="button"
                      className="outline-action"
                      disabled={payoutBusy}
                      onClick={() => void cancelPayout(payout)}
                    >
                      Cancel request
                    </button>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="earnings-zero-summary">No payout requests yet.</div>
          )}
        </div>
      </section>
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
          paginatedProviderOrders.map((order) => (
            <article className="provider-request" key={order.id}>
              <div className="request-main">
                <span
                  className={`listing-status ${order.status.toLowerCase()}`}
                  data-status={order.status}
                >
                  {formatMarketplaceStatus(order.status)}
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
                    <small>
                      {order.pricingModel === "SINGLE_PRICE_V2"
                        ? "DELIVERY"
                        : "PACKAGE"}
                    </small>
                    <b>
                      {order.pricingModel === "SINGLE_PRICE_V2"
                        ? order.deliveryOption === "NORMAL"
                          ? "Normal"
                          : `${order.deliveryDurationMinutes! / 60}-hour Rush`
                        : (order.package?.name ?? "Legacy package")}
                    </b>
                  </span>
                  <span>
                    <small>TOTAL</small>
                    <b>₱{(order.totalCentavos / 100).toLocaleString()}</b>
                  </span>
                  <span>
                    <small>
                      {order.status === "REQUESTED"
                        ? "REQUESTED DELIVERY"
                        : "DUE"}
                    </small>
                    <b>
                      {order.dueAt
                        ? formatCampusDate(order.dueAt)
                        : "Starts after payment"}
                    </b>
                  </span>
                  <span>
                    <small>PAYMENT</small>
                    <b>
                      {order.paymentStatus
                        ? formatMarketplaceStatus(order.paymentStatus)
                        : "Not paid"}
                    </b>
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
                  {order.paymentStatus === "PAID" ? (
                    <button
                      className="approve"
                      onClick={() => void startOrder(order)}
                    >
                      Start working
                    </button>
                  ) : (
                    <span className="request-decision">
                      Awaiting client payment
                    </span>
                  )}
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
        {providerOrders.length > providerRequestsPerPage && (
          <div
            className="orders-pagination provider-requests-pagination"
            role="navigation"
            aria-label="Client service request pages"
          >
            <span className="orders-page-summary">
              Showing {(requestPage - 1) * providerRequestsPerPage + 1}–
              {Math.min(
                requestPage * providerRequestsPerPage,
                providerOrders.length,
              )}{" "}
              of {providerOrders.length} requests
            </span>
            <div>
              <button
                type="button"
                aria-label="Previous service requests page"
                disabled={requestPage === 1}
                onClick={() =>
                  setRequestPage((current) => Math.max(1, current - 1))
                }
              >
                ‹
              </button>
              {Array.from(
                { length: requestPageCount },
                (_, index) => index + 1,
              ).map((pageNumber) => (
                <button
                  type="button"
                  key={pageNumber}
                  className={requestPage === pageNumber ? "active" : ""}
                  aria-label={`Open service requests page ${pageNumber}`}
                  aria-current={requestPage === pageNumber ? "page" : undefined}
                  onClick={() => setRequestPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ))}
              <button
                type="button"
                aria-label="Next service requests page"
                disabled={requestPage === requestPageCount}
                onClick={() =>
                  setRequestPage((current) =>
                    Math.min(requestPageCount, current + 1),
                  )
                }
              >
                ›
              </button>
            </div>
          </div>
        )}
        {providerOrdersHaveMore && (
          <div className="orders-pagination provider-requests-pagination">
            <button
              type="button"
              className="outline-action"
              disabled={providerOrdersLoadingMore}
              onClick={() => void loadMoreProviderOrders()}
            >
              {providerOrdersLoadingMore
                ? "Loading more orders..."
                : "Load more orders"}
            </button>
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
          {hasPendingRemoteProfile && (
            <div className="provider-remote-change" role="status">
              <div>
                <b>Your profile was updated from another device.</b>
                <span>
                  Your unsaved draft is safe. Reload to use the latest saved
                  profile, or keep editing and save your version.
                </span>
              </div>
              <button
                type="button"
                className="outline-action"
                disabled={reloadingProfile}
                onClick={() => void reloadLatestProfile()}
              >
                {reloadingProfile ? "Reloading…" : "Reload latest profile"}
              </button>
            </div>
          )}
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
            <fieldset className="provider-social-editor">
              <legend>Public links</legend>
              <p>
                Optional HTTPS links appear on your public profile. Keep
                payments and deliverables inside CampusGig.
              </p>
              <div>
                <label>
                  Instagram
                  <input
                    type="url"
                    inputMode="url"
                    maxLength={300}
                    value={profileForm.instagramUrl}
                    onChange={(event) =>
                      setProfileForm({
                        ...profileForm,
                        instagramUrl: event.target.value,
                      })
                    }
                    placeholder="https://instagram.com/username"
                  />
                </label>
                <label>
                  LinkedIn
                  <input
                    type="url"
                    inputMode="url"
                    maxLength={300}
                    value={profileForm.linkedinUrl}
                    onChange={(event) =>
                      setProfileForm({
                        ...profileForm,
                        linkedinUrl: event.target.value,
                      })
                    }
                    placeholder="https://linkedin.com/in/username"
                  />
                </label>
                <label>
                  X
                  <input
                    type="url"
                    inputMode="url"
                    maxLength={300}
                    value={profileForm.xUrl}
                    onChange={(event) =>
                      setProfileForm({
                        ...profileForm,
                        xUrl: event.target.value,
                      })
                    }
                    placeholder="https://x.com/username"
                  />
                </label>
                <label>
                  Portfolio
                  <input
                    type="url"
                    inputMode="url"
                    maxLength={300}
                    value={profileForm.portfolioUrl}
                    onChange={(event) =>
                      setProfileForm({
                        ...profileForm,
                        portfolioUrl: event.target.value,
                      })
                    }
                    placeholder="https://yourportfolio.example"
                  />
                </label>
              </div>
            </fieldset>
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
            <fieldset className="provider-social-editor provider-capacity-editor">
              <legend>Workload limits</legend>
              <p>
                CampusGig enforces these limits atomically when clients send
                requests and when you accept work.
              </p>
              <div>
                <label>
                  Active orders
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={profileForm.maxActiveOrders}
                    onChange={(event) =>
                      setProfileForm({
                        ...profileForm,
                        maxActiveOrders: Number(event.target.value),
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Pending requests
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={profileForm.maxPendingOrders}
                    onChange={(event) =>
                      setProfileForm({
                        ...profileForm,
                        maxPendingOrders: Number(event.target.value),
                      })
                    }
                    required
                  />
                </label>
              </div>
            </fieldset>
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
                {isFullyVerifiedProvider ? (
                  <div
                    className="provider-verified-stamp"
                    role="status"
                    aria-label="Verified provider profile"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m7.8 12.2 2.6 2.6 5.9-6.1" />
                    </svg>
                    <span>
                      <b>Verified provider</b>
                      <small>Profile ready for clients</small>
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="kicker">PROFILE READINESS</span>
                    <h3>{stats.profileStrength}% complete</h3>
                  </>
                )}
              </div>
              <span
                className={`availability-pill ${profileForm.isAvailable ? "available" : "paused"}`}
              >
                {profileForm.isAvailable ? "Accepting orders" : "Unavailable"}
              </span>
            </div>
            {!isFullyVerifiedProvider ? (
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
            ) : null}
            <div className="provider-checklist">
              <span className={hasCompleteProviderIdentity ? "done" : ""}>
                <b>{hasCompleteProviderIdentity ? "✓" : "1"}</b>
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
                  minLength={serviceFieldLimits.title.min}
                  maxLength={serviceFieldLimits.title.max}
                  required
                />
                <span
                  className={`provider-character-counter ${titleProgress.ready ? "ready" : "pending"}`}
                  aria-live="polite"
                >
                  <small>
                    {titleProgress.ready
                      ? "Ready"
                      : `${titleProgress.remaining} more required`}
                  </small>
                  {titleProgress.count}/{serviceFieldLimits.title.max}
                </span>
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
                  minLength={serviceFieldLimits.description.min}
                  maxLength={serviceFieldLimits.description.max}
                  required
                />
                <span
                  className={`provider-character-counter ${descriptionProgress.ready ? "ready" : "pending"}`}
                  aria-live="polite"
                >
                  <small>
                    {descriptionProgress.ready
                      ? "Ready"
                      : `${descriptionProgress.remaining} more required`}
                  </small>
                  {descriptionProgress.count}/
                  {serviceFieldLimits.description.max}
                </span>
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
              <label>
                Pricing model
                <select
                  value={serviceForm.pricingModel}
                  disabled={Boolean(editingServiceId)}
                  onChange={(event) =>
                    setServiceForm({
                      ...serviceForm,
                      pricingModel: event.target.value as
                        | "LEGACY_PACKAGES"
                        | "SINGLE_PRICE_V2",
                    })
                  }
                >
                  <option value="LEGACY_PACKAGES">Legacy packages</option>
                  <option value="SINGLE_PRICE_V2">One fixed price</option>
                </select>
                <small>
                  {editingServiceId
                    ? "The pricing model is fixed after creation."
                    : "Choose one fixed price for new Marketplace V2 listings or keep the legacy package format."}
                </small>
              </label>
              {serviceForm.pricingModel === "SINGLE_PRICE_V2" ? (
                <div className="package-editor">
                  <b>Single-price terms</b>
                  <div className="provider-form-row three">
                    <label>
                      Price (₱)
                      <input
                        type="number"
                        min="1"
                        max="100000"
                        step="1"
                        value={serviceForm.basePricePesos}
                        onChange={(event) =>
                          setServiceForm({
                            ...serviceForm,
                            basePricePesos: event.target.value,
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
                        step="1"
                        value={serviceForm.normalDeliveryDays}
                        onChange={(event) =>
                          setServiceForm({
                            ...serviceForm,
                            normalDeliveryDays: event.target.value,
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      Included revisions
                      <input
                        type="number"
                        min="0"
                        max="20"
                        step="1"
                        value={serviceForm.includedRevisionLimit}
                        onChange={(event) =>
                          setServiceForm({
                            ...serviceForm,
                            includedRevisionLimit: event.target.value,
                          })
                        }
                        required
                      />
                    </label>
                  </div>
                  <small>
                    Delivery is entered in whole days and stored by the API as
                    canonical minutes.
                  </small>
                  <label className="package-toggle">
                    <input
                      type="checkbox"
                      checked={serviceForm.acceptsRushOrders}
                      onChange={(event) =>
                        setServiceForm({
                          ...serviceForm,
                          acceptsRushOrders: event.target.checked,
                        })
                      }
                    />
                    <b>Accept rush orders</b>
                  </label>
                  {serviceForm.acceptsRushOrders && (
                    <label>
                      Fastest supported turnaround
                      <select
                        value={serviceForm.fastestRushTier}
                        onChange={(event) =>
                          setServiceForm({
                            ...serviceForm,
                            fastestRushTier: event.target.value as RushTier,
                          })
                        }
                      >
                        {rushTierOptions
                          .filter(
                            (item) =>
                              item.minutes <
                              Number(serviceForm.normalDeliveryDays) * 1440,
                          )
                          .map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                      </select>
                      <small>
                        CampusGig applies the standardized rush percentage.
                      </small>
                    </label>
                  )}
                </div>
              ) : (
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
              )}
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
                    {service.category.name} ·{" "}
                    {isSinglePriceV2ServicePricingModel(service.pricingModel)
                      ? "single price"
                      : `${service.packages.length} package${service.packages.length === 1 ? "" : "s"}`}{" "}
                    · {service.media?.length ?? 0} media file
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
                  {isLegacyServicePricingModel(service.pricingModel) ||
                  isSinglePriceV2ServicePricingModel(service.pricingModel)
                    ? `₱${Math.round(
                        (isSinglePriceV2ServicePricingModel(
                          service.pricingModel,
                        )
                          ? (service.basePriceCentavos ?? 0)
                          : (service.packages[0]?.priceCentavos ?? 0)) / 100,
                      ).toLocaleString()}`
                    : "Unsupported pricing"}
                </strong>
                <div className="listing-action-area">
                  <span className="moderation-note">
                    {providerServiceStatusCopy(service.status)}
                  </span>
                  <div className="listing-actions">
                    <button
                      className="outline-button"
                      onClick={() => setPreviewService(service)}
                    >
                      Preview
                    </button>
                    {(isLegacyServicePricingModel(service.pricingModel) ||
                      isSinglePriceV2ServicePricingModel(
                        service.pricingModel,
                      )) &&
                      providerServiceActions(service.status).includes(
                        "edit",
                      ) && (
                        <button
                          className="outline-button"
                          disabled={serviceAction?.id === service.id}
                          onClick={() => beginEditingService(service)}
                        >
                          Edit
                        </button>
                      )}
                    {(isLegacyServicePricingModel(service.pricingModel) ||
                      isSinglePriceV2ServicePricingModel(
                        service.pricingModel,
                      )) &&
                      providerServiceActions(service.status).includes(
                        "submit",
                      ) && (
                        <button
                          className="approve"
                          onClick={() => submitService(service)}
                        >
                          Submit for review
                        </button>
                      )}
                    {providerServiceActions(service.status).includes(
                      "pause",
                    ) && (
                      <button
                        className="outline-button"
                        disabled={serviceAction?.id === service.id}
                        onClick={() => transitionService(service, "pause")}
                      >
                        Pause
                      </button>
                    )}
                    {providerServiceActions(service.status).includes(
                      "resume",
                    ) && (
                      <button
                        className="approve"
                        disabled={serviceAction?.id === service.id}
                        onClick={() => transitionService(service, "resume")}
                      >
                        Resume
                      </button>
                    )}
                    {providerServiceActions(service.status).includes(
                      "archive",
                    ) && (
                      <button
                        className="listing-archive-button"
                        disabled={serviceAction?.id === service.id}
                        onClick={() => transitionService(service, "archive")}
                      >
                        Archive
                      </button>
                    )}
                    {providerServiceActions(service.status).includes(
                      "restore",
                    ) && (
                      <button
                        className="outline-button"
                        disabled={serviceAction?.id === service.id}
                        onClick={() => transitionService(service, "restore")}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </div>
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
      {previewService &&
        createPortal(
          <div
            className="listing-preview-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setPreviewService(null);
            }}
          >
            <section
              className="listing-preview-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="listing-preview-title"
            >
              <header>
                <div>
                  <span className="kicker">CLIENT PREVIEW</span>
                  <h2 id="listing-preview-title">{previewService.title}</h2>
                </div>
                <button
                  ref={previewCloseRef}
                  className="listing-preview-close"
                  onClick={() => setPreviewService(null)}
                  aria-label="Close listing preview"
                >
                  ×
                </button>
              </header>
              <div className="listing-preview-meta">
                <span>{previewService.category.name}</span>
                <span>
                  {previewService.deliveryMethod
                    .toLowerCase()
                    .replace("_", " ")}
                </span>
                <span>{previewService.media.length} portfolio files</span>
              </div>
              <p>{previewService.description}</p>
              {previewService.campusLocation && (
                <div className="listing-preview-location">
                  <b>Campus location</b>
                  <span>{previewService.campusLocation}</span>
                </div>
              )}
              <div className="listing-preview-packages">
                {isSinglePriceV2ServicePricingModel(
                  previewService.pricingModel,
                ) ? (
                  <article>
                    <span>SINGLE PRICE</span>
                    <h3>Included service</h3>
                    <strong>
                      ₱
                      {Math.round(
                        (previewService.basePriceCentavos ?? 0) / 100,
                      ).toLocaleString()}
                    </strong>
                    <small>
                      {formatDeliveryMinutes(
                        previewService.normalDeliveryMinutes,
                      )}{" "}
                      delivery · {previewService.includedRevisionLimit ?? 0}{" "}
                      revision
                      {previewService.includedRevisionLimit === 1 ? "" : "s"}
                    </small>
                  </article>
                ) : isLegacyServicePricingModel(previewService.pricingModel) ? (
                  previewService.packages
                    .filter((item) => item.isActive)
                    .map((item) => (
                      <article key={item.id}>
                        <span>{item.tier}</span>
                        <h3>{item.name}</h3>
                        <p>{item.description}</p>
                        <strong>
                          ₱
                          {Math.round(
                            item.priceCentavos / 100,
                          ).toLocaleString()}
                        </strong>
                        <small>
                          {item.deliveryDays} day delivery ·{" "}
                          {item.revisionLimit} revision
                          {item.revisionLimit === 1 ? "" : "s"}
                        </small>
                      </article>
                    ))
                ) : (
                  <article>
                    <span>UNSUPPORTED PRICING</span>
                    <p>This listing cannot be previewed in this app version.</p>
                  </article>
                )}
              </div>
              <footer>
                <span
                  className={`listing-status ${previewService.status.toLowerCase().replace("_", "-")}`}
                >
                  {previewService.status.replace("_", " ")}
                </span>
                <small>
                  {isSinglePriceV2ServicePricingModel(
                    previewService.pricingModel,
                  )
                    ? "Preview only. Single-price V2 booking is not available in this phase."
                    : isLegacyServicePricingModel(previewService.pricingModel)
                      ? "Preview only. Clients can book this service only while it is published."
                      : "Preview only. This pricing model is unsupported in this app version."}
                </small>
              </footer>
            </section>
          </div>,
          document.body,
        )}
      {workspaceOrder && (
        <WebOrderWorkspace
          token={token}
          order={workspaceOrder}
          onClose={() => setWorkspaceOrder(null)}
          onChanged={refresh}
        />
      )}
      {appDialog.dialog}
    </main>
  );
}
