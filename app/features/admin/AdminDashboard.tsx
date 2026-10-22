"use client";

import {
  FormEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "../../lib/api";
import { useAppDialog } from "../../components/app-dialog";
import { Icon } from "../../components/brand";
import { SkeletonCollection } from "../../components/Skeletons";
import { formatMarketplaceStatus } from "../../lib/marketplace-presentation";
import {
  formatDeliveryMinutes,
  isSinglePriceV2ServicePricingModel,
} from "../../lib/pricing-model";
import type {
  DashboardStats,
  ModerationService,
  OrderDispute,
  MarketplaceRefund,
  StaleRevisionRefundCandidate,
  AdminProviderPayout,
  PayoutDestination,
  School,
  SchoolAdministrator,
  Verification,
} from "../../types";

const SCHOOL_PAGE_SIZE = 5;
const emptyCursorPage = { hasMore: false, nextCursor: null as string | null };

export function AdminDashboard({
  token,
  notify,
  onSchoolStatusChanged,
  onExit,
}: {
  token: string;
  notify: (s: string) => void;
  onSchoolStatusChanged: (school: School) => void;
  onExit: () => void;
}) {
  const appDialog = useAppDialog();
  const [queue, setQueue] = useState<Verification[]>([]);
  const [serviceQueue, setServiceQueue] = useState<ModerationService[]>([]);
  const [disputes, setDisputes] = useState<OrderDispute[]>([]);
  const [refunds, setRefunds] = useState<MarketplaceRefund[]>([]);
  const [staleRevisionRefunds, setStaleRevisionRefunds] = useState<
    StaleRevisionRefundCandidate[]
  >([]);
  const [payouts, setPayouts] = useState<AdminProviderPayout[]>([]);
  const [payoutDestinations, setPayoutDestinations] = useState<
    (PayoutDestination & {
      provider: { id: string; displayName: string; email: string };
    })[]
  >([]);
  const [disputeFilter, setDisputeFilter] = useState("");
  const [selectedDispute, setSelectedDispute] = useState<OrderDispute | null>(
    null,
  );
  const selectedDisputeId = selectedDispute?.id;
  const [schoolAdmins, setSchoolAdmins] = useState<SchoolAdministrator[]>([]);
  const [verificationPage, setVerificationPage] = useState(emptyCursorPage);
  const [servicePage, setServicePage] = useState(emptyCursorPage);
  const [disputePage, setDisputePage] = useState(emptyCursorPage);
  const [schoolAdminPage, setSchoolAdminPage] = useState(emptyCursorPage);
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    registeredStudents: 0,
    activeServices: 0,
    completedOrders: 0,
    pendingVerifications: 0,
  });
  const [loading, setLoading] = useState(true);
  const [schoolDrawerOpen, setSchoolDrawerOpen] = useState(false);
  const [schoolPage, setSchoolPage] = useState(1);
  const [activeAdminSection, setActiveAdminSection] = useState<
    "overview" | "moderation" | "schools"
  >("overview");
  const schoolDrawerCloseRef = useRef<HTMLButtonElement>(null);
  const disputeDialogCloseRef = useRef<HTMLButtonElement>(null);
  const [schoolForm, setSchoolForm] = useState({
    name: "",
    shortName: "",
    emailDomain: "",
    address: "",
  });
  const [schoolAdminForm, setSchoolAdminForm] = useState({
    email: "",
    schoolId: "",
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [
        nextQueue,
        nextServices,
        nextSchools,
        nextSchoolAdmins,
        nextStats,
        nextDisputes,
        nextRefunds,
        nextStaleRevisionRefunds,
        nextPayouts,
        nextPayoutDestinations,
      ] = await Promise.all([
        api.verifications(token),
        api.moderationServices(token),
        api.adminSchools(token),
        api.schoolAdministrators(token),
        api.adminStats(token),
        api.adminDisputes(token, undefined, disputeFilter || undefined),
        api.adminRefunds(token),
        api.staleRevisionRefunds(token),
        api.adminPayouts(token),
        api.adminPayoutDestinations(token),
      ]);
      setQueue(nextQueue.data);
      setVerificationPage(nextQueue.pagination);
      setServiceQueue(nextServices.data);
      setServicePage(nextServices.pagination);
      setSchools(nextSchools);
      setSchoolAdmins(nextSchoolAdmins.data);
      setSchoolAdminPage(nextSchoolAdmins.pagination);
      setStats(nextStats);
      setDisputes(nextDisputes.data);
      setDisputePage(nextDisputes.pagination);
      setRefunds(nextRefunds.data);
      setStaleRevisionRefunds(nextStaleRevisionRefunds.data);
      setPayouts(nextPayouts.data);
      setPayoutDestinations(nextPayoutDestinations.data);
    } catch {
      notify("Unable to load administrator data");
    } finally {
      setLoading(false);
    }
  }, [disputeFilter, notify, token]);

  async function issueDisputeRefund(item: OrderDispute) {
    if (
      !(await appDialog.confirm({
        title: "Issue full refund?",
        message:
          "CampusGig will refund the exact affected purchase, including the platform fee. Provider earnings stay frozen until PayMongo confirms success.",
        confirmLabel: "Issue full refund",
        tone: "danger",
      }))
    )
      return;
    try {
      const result = await api.refundFromDispute(token, item.id);
      setRefunds((current) => [
        result.data,
        ...current.filter((refund) => refund.id !== result.data.id),
      ]);
      notify(`Refund ${formatMarketplaceStatus(result.data.status)}`);
    } catch (error) {
      await appDialog.alert({
        title: "Refund needs attention",
        message:
          error instanceof Error ? error.message : "Unable to issue refund",
        tone: "danger",
      });
      await refresh();
    }
  }

  async function reconcileRefund(item: MarketplaceRefund) {
    try {
      const result = await api.reconcileRefund(token, item.id);
      setRefunds((current) =>
        current.map((refund) =>
          refund.id === result.data.id ? result.data : refund,
        ),
      );
      notify(`Refund ${formatMarketplaceStatus(result.data.status)}`);
    } catch (error) {
      await appDialog.alert({
        title: "Reconciliation unavailable",
        message:
          error instanceof Error ? error.message : "Unable to reconcile refund",
        tone: "danger",
      });
    }
  }

  async function refundStaleRevision(item: StaleRevisionRefundCandidate) {
    if (
      !(await appDialog.confirm({
        title: "Refund stale revision payment?",
        message: `Refund the exact ${item.order.orderNumber} extra-revision payment, including its CampusGig fee. The stale revision will never activate.`,
        confirmLabel: "Issue full refund",
        tone: "danger",
      }))
    )
      return;
    try {
      const result = await api.refundStaleRevision(token, item.id);
      setStaleRevisionRefunds((current) =>
        current.filter((candidate) => candidate.id !== item.id),
      );
      setRefunds((current) => [result.data, ...current]);
      notify(`Refund ${formatMarketplaceStatus(result.data.status)}`);
    } catch (error) {
      await appDialog.alert({
        title: "Refund needs attention",
        message:
          error instanceof Error ? error.message : "Unable to refund revision",
        tone: "danger",
      });
      await refresh();
    }
  }

  async function loadMoreQueue(
    queueName: "verifications" | "services" | "disputes" | "school-admins",
  ) {
    if (loadingMore) return;
    setLoadingMore(queueName);
    try {
      if (queueName === "verifications" && verificationPage.nextCursor) {
        const page = await api.verifications(
          token,
          verificationPage.nextCursor,
        );
        setQueue((current) => [...current, ...page.data]);
        setVerificationPage(page.pagination);
      } else if (queueName === "services" && servicePage.nextCursor) {
        const page = await api.moderationServices(
          token,
          servicePage.nextCursor,
        );
        setServiceQueue((current) => [...current, ...page.data]);
        setServicePage(page.pagination);
      } else if (queueName === "disputes" && disputePage.nextCursor) {
        const page = await api.adminDisputes(
          token,
          disputePage.nextCursor,
          disputeFilter || undefined,
        );
        setDisputes((current) => [...current, ...page.data]);
        setDisputePage(page.pagination);
      } else if (queueName === "school-admins" && schoolAdminPage.nextCursor) {
        const page = await api.schoolAdministrators(
          token,
          schoolAdminPage.nextCursor,
        );
        setSchoolAdmins((current) => [...current, ...page.data]);
        setSchoolAdminPage(page.pagination);
      }
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Unable to load more");
    } finally {
      setLoadingMore(null);
    }
  }
  function updateDispute(updated: OrderDispute) {
    setDisputes((items) =>
      items.map((entry) => (entry.id === updated.id ? updated : entry)),
    );
    setSelectedDispute((current) =>
      current?.id === updated.id ? updated : current,
    );
  }
  async function reviewDispute(item: OrderDispute) {
    try {
      const result = await api.beginDisputeReview(token, item.id);
      updateDispute(result.data);
      notify("Dispute moved to review");
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to review dispute",
      );
    }
  }
  async function inspectDispute(item: OrderDispute) {
    try {
      const result = await api.disputeDetail(token, item.id);
      setSelectedDispute(result.data);
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to load dispute",
      );
    }
  }
  async function requestDisputeResponse(
    item: OrderDispute,
    party: "CLIENT" | "PROVIDER",
  ) {
    try {
      const result = await api.requestDisputeResponse(token, item.id, party);
      updateDispute(result.data);
      notify(result.message);
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to request response",
      );
    }
  }
  async function markDisputeReady(item: OrderDispute) {
    try {
      const result = await api.markDisputeReady(token, item.id);
      updateDispute(result.data);
      notify("Dispute marked ready for review");
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to update dispute",
      );
    }
  }
  async function downloadAdminEvidence(
    disputeId: string,
    evidenceId: string,
    originalName: string,
  ) {
    try {
      const blob = await api.adminDisputeEvidence(token, disputeId, evidenceId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = originalName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to download evidence",
      );
    }
  }
  async function resolveDispute(
    item: OrderDispute,
    status: "RESOLVED_CLIENT" | "RESOLVED_PROVIDER" | "CLOSED",
  ) {
    const resolutionLabel = formatMarketplaceStatus(status).toLowerCase();
    const note = await appDialog.prompt({
      title: `Confirm ${resolutionLabel}?`,
      message:
        "Enter the final resolution details. Both participants will receive this message.",
      placeholder: "Describe the decision and any required next steps…",
      minLength: 10,
      maxLength: 1000,
      validationMessage:
        "Resolution details must contain at least 10 characters.",
      confirmLabel: "Resolve dispute",
      cancelLabel: "Continue reviewing",
      tone: status === "CLOSED" ? "danger" : "default",
    });
    if (!note) return;
    try {
      const result = await api.resolveDispute(token, item.id, status, note);
      updateDispute(result.data);
      notify(result.message);
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to resolve dispute",
      );
    }
  }
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(schools.length / SCHOOL_PAGE_SIZE));
    setSchoolPage((current) => Math.min(current, lastPage));
  }, [schools.length]);

  useEffect(() => {
    if (!schoolDrawerOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSchoolDrawerOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    schoolDrawerCloseRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [schoolDrawerOpen]);

  useEffect(() => {
    if (!selectedDisputeId) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedDispute(null);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    disputeDialogCloseRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [selectedDisputeId]);

  useEffect(() => {
    const sections = (["overview", "moderation", "schools"] as const)
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));
    let frame = 0;

    const updateActiveSection = () => {
      frame = 0;
      const marker = 160;
      let current: "overview" | "moderation" | "schools" = "overview";
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= marker) {
          current = section.id as typeof current;
        }
      }
      const atPageEnd =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 4;
      if (atPageEnd) current = "schools";
      setActiveAdminSection(current);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [loading]);

  async function review(item: Verification, decision: "approve" | "reject") {
    const reason =
      decision === "reject"
        ? await appDialog.prompt({
            title: "Return this verification?",
            message:
              "Explain what must be corrected. The student will see this reason.",
            placeholder: "Describe the verification issue…",
            minLength: 3,
            maxLength: 500,
            confirmLabel: "Return verification",
            cancelLabel: "Keep reviewing",
            tone: "danger",
          })
        : "";
    if (decision === "reject" && !reason) return;
    if (
      decision === "approve" &&
      !(await appDialog.confirm({
        title: "Approve this student?",
        message:
          "Their student identity will be verified and provider access may be unlocked.",
        confirmLabel: "Approve student",
        cancelLabel: "Review again",
      }))
    )
      return;
    try {
      if (decision === "approve") await api.approveVerification(token, item.id);
      else await api.rejectVerification(token, item.id, reason!);
      setQueue((items) => items.filter((entry) => entry.id !== item.id));
      setStats((value) => ({
        ...value,
        pendingVerifications: Math.max(0, value.pendingVerifications - 1),
      }));
      notify(
        `Verification ${decision === "approve" ? "approved" : "returned"}`,
      );
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to review verification",
      );
    }
  }
  async function openDocument(item: Verification) {
    try {
      const blob = await api.verificationDocument(token, item.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      notify("Unable to open the private student document");
    }
  }
  async function moderateService(
    item: ModerationService,
    decision: "approve" | "reject",
  ) {
    const reason =
      decision === "reject"
        ? await appDialog.prompt({
            title: "Return this service?",
            message:
              "Explain what must be corrected before it can be published. The provider will see this reason.",
            placeholder: "Describe the listing issue…",
            minLength: 3,
            maxLength: 500,
            confirmLabel: "Return service",
            cancelLabel: "Keep reviewing",
            tone: "danger",
          })
        : "";
    if (decision === "reject" && !reason) return;
    if (
      decision === "approve" &&
      !(await appDialog.confirm({
        title: "Publish this service?",
        message:
          "The listing will become visible in the marketplace immediately.",
        confirmLabel: "Approve and publish",
        cancelLabel: "Review again",
      }))
    )
      return;
    try {
      if (decision === "approve") await api.approveService(token, item.id);
      else await api.rejectService(token, item.id, reason!);
      setServiceQueue((items) => items.filter((entry) => entry.id !== item.id));
      if (decision === "approve")
        setStats((value) => ({
          ...value,
          activeServices: value.activeServices + 1,
        }));
      notify(
        `Service ${decision === "approve" ? "approved and published" : "returned to the provider"}`,
      );
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to moderate service",
      );
    }
  }
  async function addSchool(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await api.createSchool(token, {
        ...schoolForm,
        emailDomain: schoolForm.emailDomain || undefined,
        address: schoolForm.address || undefined,
      });
      setSchools((items) =>
        [...items, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSchoolPage(1);
      setSchoolForm({ name: "", shortName: "", emailDomain: "", address: "" });
      setSchoolDrawerOpen(false);
      notify("Participating school added as pending");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Unable to add school");
    }
  }
  async function changeSchoolStatus(
    school: School,
    status: "PENDING" | "ACTIVE" | "DISABLED",
  ) {
    if (
      !(await appDialog.confirm({
        title: `Set ${school.shortName} to ${status.toLowerCase()}?`,
        message:
          status === "DISABLED"
            ? "The school and its provider services will no longer appear in the active marketplace."
            : "This updates campus access immediately across the platform.",
        confirmLabel: "Update status",
        cancelLabel: "Keep current status",
        tone: status === "DISABLED" ? "danger" : "default",
      }))
    )
      return;
    try {
      const updated = await api.updateSchoolStatus(token, school.id, status);
      setSchools((items) =>
        items.map((item) => (item.id === school.id ? updated : item)),
      );
      onSchoolStatusChanged(updated);
      notify(`${school.shortName} is now ${status.toLowerCase()}`);
    } catch {
      notify("Unable to update school status");
    }
  }
  async function assignSchoolAdmin(event: FormEvent) {
    event.preventDefault();
    try {
      const assignment = await api.assignSchoolAdministrator(
        token,
        schoolAdminForm.email.trim(),
        schoolAdminForm.schoolId,
      );
      setSchoolAdmins((items) => [
        assignment,
        ...items.filter((item) => item.userId !== assignment.userId),
      ]);
      setSchoolAdminForm({ email: "", schoolId: "" });
      notify("School administrator access assigned");
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to assign school administrator",
      );
    }
  }
  async function removeSchoolAdmin(item: SchoolAdministrator) {
    if (
      !(await appDialog.confirm({
        title: "Remove administrator access?",
        message: `${item.user.displayName} will no longer be able to review students for this school.`,
        confirmLabel: "Remove access",
        cancelLabel: "Keep access",
        tone: "danger",
      }))
    )
      return;
    try {
      await api.removeSchoolAdministrator(token, item.userId);
      setSchoolAdmins((items) =>
        items.filter((entry) => entry.userId !== item.userId),
      );
      notify("School administrator access removed");
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to remove school administrator",
      );
    }
  }

  async function reviewPayoutDestination(destination: PayoutDestination) {
    try {
      const result = await api.sensitivePayoutDestination(
        token,
        destination.id,
      );
      await appDialog.alert({
        title: "Verify payout destination",
        message: `${result.data.type.replaceAll("_", " ")} · ${result.data.accountHolderName} · ${result.data.accountIdentifier}. Compare these transfer details with the provider's ownership evidence before continuing. Access to these details is security logged.`,
        confirmLabel: "Continue review",
      });
    } catch (caught) {
      await appDialog.alert({
        title: "Transfer details unavailable",
        message:
          caught instanceof Error
            ? caught.message
            : "Unable to securely load this payout destination",
        tone: "danger",
      });
      return;
    }
    const note = await appDialog.prompt({
      title: "Record destination review",
      message:
        "Record the evidence checked by an administrator. This does not claim bank or provider verification.",
      placeholder: "Describe the identity and ownership evidence reviewed",
      minLength: 20,
      maxLength: 1000,
      confirmLabel: "Mark admin reviewed",
    });
    if (!note) return;
    try {
      await api.reviewPayoutDestination(token, destination.id, note);
      await refresh();
      notify("Destination marked administrator reviewed");
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to review destination",
      );
    }
  }

  async function viewPayoutDestination(destinationId: string) {
    try {
      const result = await api.sensitivePayoutDestination(token, destinationId);
      await appDialog.alert({
        title: "Manual transfer details",
        message: `${result.data.type.replaceAll("_", " ")} · ${result.data.accountHolderName} · ${result.data.accountIdentifier}. Use only for this payout and verify the recipient before sending money. Access is security logged.`,
        confirmLabel: "Close details",
      });
    } catch (caught) {
      await appDialog.alert({
        title: "Transfer details unavailable",
        message:
          caught instanceof Error
            ? caught.message
            : "Unable to securely load this payout destination",
        tone: "danger",
      });
    }
  }

  async function decidePayout(
    payout: AdminProviderPayout,
    decision: "approve" | "reject",
  ) {
    const note = await appDialog.prompt({
      title: `${decision === "approve" ? "Approve" : "Reject"} payout?`,
      message: `${payout.currency} ${(payout.netDisbursementCentavos / 100).toFixed(2)} is immutable. Approval does not send money.`,
      placeholder: "Record the review evidence and decision rationale",
      minLength: 20,
      maxLength: 1000,
      confirmLabel:
        decision === "approve" ? "Approve only" : "Reject and release",
      tone: decision === "reject" ? "danger" : "default",
    });
    if (!note) return;
    try {
      await api.decidePayout(token, payout.id, decision, note);
      await refresh();
      notify(`Payout ${decision === "approve" ? "approved" : "rejected"}`);
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to decide payout",
      );
    }
  }

  async function beginManualPayout(payout: AdminProviderPayout) {
    const note = await appDialog.prompt({
      title: "Begin manual settlement?",
      message:
        "This records an operational processing step only. It does not send money or mark the payout paid.",
      placeholder: "Describe the authorized offline settlement procedure",
      minLength: 20,
      maxLength: 1000,
      confirmLabel: "Begin manual settlement",
    });
    if (!note) return;
    try {
      await api.beginManualPayout(token, payout.id, note);
      await refresh();
      notify("Manual settlement processing recorded; payout is not yet paid");
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to begin manual settlement",
      );
    }
  }

  async function settleManualPayout(payout: AdminProviderPayout) {
    const manualReference = await appDialog.prompt({
      title: "Enter settlement reference",
      message: `Evidence must support the exact immutable net amount ${payout.currency} ${(payout.netDisbursementCentavos / 100).toFixed(2)} and the masked destination snapshot.`,
      placeholder: "External or offline settlement reference",
      minLength: 4,
      maxLength: 120,
      confirmLabel: "Continue",
    });
    if (!manualReference) return;
    const note = await appDialog.prompt({
      title: "Record settlement evidence",
      message:
        "Describe who verified receipt and which evidence supports this manual settlement.",
      placeholder: "Required evidence note",
      minLength: 20,
      maxLength: 1000,
      confirmLabel: "Review confirmation",
    });
    if (!note) return;
    if (
      !(await appDialog.confirm({
        title: "Confirm manual settlement evidence?",
        message:
          "This final step records the payout as PAID and moves every exact payout item to PAID OUT. CampusGig is not initiating a transfer.",
        confirmLabel: "Confirm evidence and mark paid",
        tone: "danger",
      }))
    )
      return;
    try {
      await api.settleManualPayout(token, payout.id, {
        amountCentavos: payout.netDisbursementCentavos,
        manualReference,
        settledAt: new Date().toISOString(),
        note,
      });
      await refresh();
      notify("Manual settlement evidence recorded");
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to record settlement",
      );
    }
  }

  const activeDisputeCount = disputes.filter((item) =>
    [
      "OPEN",
      "WAITING_FOR_CLIENT",
      "WAITING_FOR_PROVIDER",
      "READY_FOR_REVIEW",
      "UNDER_REVIEW",
    ].includes(item.status),
  ).length;
  const activeSchoolCount = schools.filter(
    (school) => school.status === "ACTIVE",
  ).length;
  const actionItemCount =
    activeDisputeCount + serviceQueue.length + queue.length;
  const schoolPageCount = Math.max(
    1,
    Math.ceil(schools.length / SCHOOL_PAGE_SIZE),
  );
  const visibleSchools = schools.slice(
    (schoolPage - 1) * SCHOOL_PAGE_SIZE,
    schoolPage * SCHOOL_PAGE_SIZE,
  );
  const navigateToAdminSection = (
    event: MouseEvent<HTMLAnchorElement>,
    section: "overview" | "moderation" | "schools",
  ) => {
    event.preventDefault();
    setActiveAdminSection(section);
    document.getElementById(section)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };

  return (
    <div className="admin-dashboard-shell">
      <header className="admin-command-bar">
        <div className="admin-workspace-label">
          <span className="kicker">ADMIN WORKSPACE</span>
        </div>
        <nav
          aria-label="Administrator navigation"
          data-active={activeAdminSection}
        >
          <a
            href="#overview"
            className={activeAdminSection === "overview" ? "active" : ""}
            onClick={(event) => navigateToAdminSection(event, "overview")}
          >
            Overview
          </a>
          <a
            href="#moderation"
            className={activeAdminSection === "moderation" ? "active" : ""}
            onClick={(event) => navigateToAdminSection(event, "moderation")}
          >
            Reviews
            {actionItemCount > 0 && <b>{actionItemCount}</b>}
          </a>
          <a
            href="#schools"
            className={activeAdminSection === "schools" ? "active" : ""}
            onClick={(event) => navigateToAdminSection(event, "schools")}
          >
            Schools
          </a>
        </nav>
        <div className="admin-command-actions">
          <button
            type="button"
            className="admin-exit"
            onClick={onExit}
            aria-label="Exit admin"
            title="Exit admin"
          >
            <Icon name="exit" />
          </button>
        </div>
      </header>
      <main className="dashboard-page admin-overview-page" id="overview">
        <header className="admin-overview-header">
          <div>
            <span className="kicker">CAMPUSGIG ADMIN</span>
            <h1>Platform overview</h1>
            <p>Review activity and manage campus access.</p>
          </div>
        </header>
        <div className="admin-summary-bar" aria-label="Platform summary">
          <span>
            <strong>{actionItemCount}</strong> need review
          </span>
          <span>
            <strong>{stats.registeredStudents}</strong> students
          </span>
          <span>
            <strong>{stats.activeServices}</strong> active services
          </span>
          <span>
            <strong>{stats.completedOrders}</strong> completed orders
          </span>
          <span>
            <strong>{activeSchoolCount}</strong> active schools
          </span>
        </div>
        {loading ? (
          <SkeletonCollection
            kind="admin"
            count={4}
            label="Loading administrator workspace"
          />
        ) : (
          <>
            <div className="admin-section-heading" id="moderation">
              <div>
                <span className="kicker">ACTION CENTER</span>
                <h2>Priority review queues</h2>
              </div>
              <p>Items that need an administrator decision appear here.</p>
            </div>
            <div className="admin-action-grid">
              <section className="panel admin-panel admin-panel-services">
                <div className="panel-title">
                  <div>
                    <span className="kicker">FINANCIAL OPERATIONS</span>
                    <h2>Provider payout queue</h2>
                  </div>
                  <span className="queue-count">{payouts.length} records</span>
                </div>
                {payoutDestinations
                  .filter(
                    (destination) =>
                      destination.verificationStatus === "UNVERIFIED",
                  )
                  .map((destination) => (
                    <div className="service-review-row" key={destination.id}>
                      <div className="service-review-main">
                        <b>{destination.provider.displayName}</b>
                        <small>
                          {destination.displayLabel} ·{" "}
                          {destination.maskedAccountIdentifier}
                        </small>
                        <p>
                          {destination.type.replaceAll("_", " ")} ·{" "}
                          {destination.accountHolderName} · UNVERIFIED
                        </p>
                      </div>
                      <div className="verify-actions">
                        <button
                          className="approve"
                          onClick={() =>
                            void reviewPayoutDestination(destination)
                          }
                        >
                          Review destination
                        </button>
                      </div>
                    </div>
                  ))}
                {payouts.length ? (
                  payouts.map((payout) => (
                    <div className="service-review-row" key={payout.id}>
                      <div className="service-review-main">
                        <b>{payout.provider.displayName}</b>
                        <small>
                          {payout.destinationSnapshot.displayLabel} ·{" "}
                          {payout.destinationSnapshot.maskedAccountIdentifier}
                        </small>
                        <p>
                          {payout.items.length} exact earning
                          {payout.items.length === 1 ? "" : "s"} · Principal{" "}
                          {payout.currency}{" "}
                          {(payout.requestedPrincipalCentavos / 100).toFixed(2)}{" "}
                          · Fee {payout.currency}{" "}
                          {(payout.payoutFeeCentavos / 100).toFixed(2)} · Net{" "}
                          {payout.currency}{" "}
                          {(payout.netDisbursementCentavos / 100).toFixed(2)}
                        </p>
                        <small>
                          Requested{" "}
                          {new Date(payout.requestedAt).toLocaleString()} ·{" "}
                          {formatMarketplaceStatus(payout.status)}
                        </small>
                        {payout.audits.length > 0 && (
                          <p className="moderation-note">
                            Audit:{" "}
                            {payout.audits
                              .map(
                                (audit) =>
                                  `${audit.action} by ${audit.actor?.displayName ?? "system"} at ${new Date(audit.createdAt).toLocaleString()}`,
                              )
                              .join(" | ")}
                          </p>
                        )}
                      </div>
                      <div className="verify-actions">
                        {(payout.status === "APPROVED" ||
                          payout.status === "PROCESSING") && (
                          <button
                            onClick={() =>
                              void viewPayoutDestination(payout.destinationId)
                            }
                          >
                            View transfer details
                          </button>
                        )}
                        {payout.status === "REQUESTED" && (
                          <>
                            <button
                              className="approve"
                              onClick={() =>
                                void decidePayout(payout, "approve")
                              }
                            >
                              Approve only
                            </button>
                            <button
                              className="reject"
                              onClick={() =>
                                void decidePayout(payout, "reject")
                              }
                            >
                              Reject and release
                            </button>
                          </>
                        )}
                        {payout.status === "APPROVED" && (
                          <button
                            onClick={() => void beginManualPayout(payout)}
                          >
                            Begin manual settlement
                          </button>
                        )}
                        {payout.status === "PROCESSING" &&
                          payout.settlementMethod === "MANUAL" && (
                            <button
                              className="approve"
                              onClick={() => void settleManualPayout(payout)}
                            >
                              Record settlement evidence
                            </button>
                          )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty compact">
                    <h3>No provider payout requests</h3>
                    <p>
                      Reviewed requests will appear here without implying money
                      movement.
                    </p>
                  </div>
                )}
              </section>
              <section className="panel admin-panel admin-panel-disputes">
                <div className="panel-title">
                  <div>
                    <span className="kicker">ORDER PROTECTION</span>
                    <h2>Dispute review queue</h2>
                  </div>
                  <span className="queue-count">
                    {activeDisputeCount} active
                  </span>
                </div>
                <label className="admin-dispute-filter">
                  <span>Dispute status</span>
                  <span className="admin-select-control">
                    <select
                      value={disputeFilter}
                      onChange={(event) => setDisputeFilter(event.target.value)}
                    >
                      <option value="">All statuses</option>
                      <option value="WAITING_FOR_CLIENT">
                        Waiting for client
                      </option>
                      <option value="WAITING_FOR_PROVIDER">
                        Waiting for provider
                      </option>
                      <option value="READY_FOR_REVIEW">Ready for review</option>
                      <option value="UNDER_REVIEW">Under review</option>
                      <option value="RESOLVED_CLIENT">
                        Resolved for client
                      </option>
                      <option value="RESOLVED_PROVIDER">
                        Resolved for provider
                      </option>
                      <option value="CLOSED">Closed</option>
                    </select>
                    <i aria-hidden="true" />
                  </span>
                </label>
                {disputes.length ? (
                  disputes.map((item) => (
                    <div className="dispute-admin-row" key={item.id}>
                      <div>
                        <b>{item.reason.replaceAll("_", " ")}</b>
                        <small>
                          Order {item.orderId.slice(0, 8)} · Opened by{" "}
                          {item.openedBy.displayName}
                        </small>
                        <p>{item.details}</p>
                      </div>
                      <span className="school-status active">
                        {formatMarketplaceStatus(item.status)}
                      </span>
                      {item.responseDeadlineAt &&
                        (item.status === "WAITING_FOR_CLIENT" ||
                          item.status === "WAITING_FOR_PROVIDER") && (
                          <small>
                            Due{" "}
                            {new Date(item.responseDeadlineAt).toLocaleString()}
                            {new Date(item.responseDeadlineAt).getTime() <
                            Date.now()
                              ? " · OVERDUE"
                              : ""}
                          </small>
                        )}
                      <div className="verify-actions">
                        <button
                          type="button"
                          className="outline-button admin-details-button"
                          onClick={() => void inspectDispute(item)}
                        >
                          Details
                        </button>
                        {[
                          "OPEN",
                          "WAITING_FOR_CLIENT",
                          "WAITING_FOR_PROVIDER",
                          "READY_FOR_REVIEW",
                          "UNDER_REVIEW",
                        ].includes(item.status) && (
                          <>
                            <button
                              onClick={() =>
                                void requestDisputeResponse(item, "CLIENT")
                              }
                            >
                              Request client
                            </button>
                            <button
                              onClick={() =>
                                void requestDisputeResponse(item, "PROVIDER")
                              }
                            >
                              Request provider
                            </button>
                          </>
                        )}
                      </div>
                      {[
                        "OPEN",
                        "WAITING_FOR_CLIENT",
                        "WAITING_FOR_PROVIDER",
                      ].includes(item.status) && (
                        <div className="verify-actions">
                          <button onClick={() => void markDisputeReady(item)}>
                            Mark ready
                          </button>
                        </div>
                      )}
                      {(item.status === "OPEN" ||
                        item.status === "READY_FOR_REVIEW") && (
                        <div className="verify-actions">
                          <button onClick={() => void reviewDispute(item)}>
                            Begin review
                          </button>
                        </div>
                      )}
                      {item.status === "UNDER_REVIEW" && (
                        <div className="verify-actions">
                          <button
                            className="approve"
                            onClick={() =>
                              void resolveDispute(item, "RESOLVED_CLIENT")
                            }
                          >
                            Client
                          </button>
                          <button
                            onClick={() =>
                              void resolveDispute(item, "RESOLVED_PROVIDER")
                            }
                          >
                            Provider
                          </button>
                          <button
                            className="reject"
                            onClick={() => void resolveDispute(item, "CLOSED")}
                          >
                            Close
                          </button>
                        </div>
                      )}
                      {item.status === "RESOLVED_CLIENT" && (
                        <div className="verify-actions">
                          <button
                            className="approve"
                            onClick={() => void issueDisputeRefund(item)}
                          >
                            Issue exact full refund
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="empty compact">
                    <h3>No order disputes</h3>
                    <p>New participant reports will appear here.</p>
                  </div>
                )}
                {disputePage.hasMore && (
                  <button
                    className="primary-button"
                    disabled={loadingMore === "disputes"}
                    onClick={() => void loadMoreQueue("disputes")}
                  >
                    {loadingMore === "disputes"
                      ? "Loading..."
                      : "Load more disputes"}
                  </button>
                )}
              </section>
              <section className="panel admin-panel admin-panel-services">
                <div className="panel-title">
                  <div>
                    <span className="kicker">REFUND CONTROL</span>
                    <h2>Full refund queue</h2>
                  </div>
                  <span className="queue-count">{refunds.length} records</span>
                </div>
                {staleRevisionRefunds.map((item) => (
                  <div className="service-review-row" key={item.id}>
                    <div className="service-review-main">
                      <b>{item.order.orderNumber} · stale paid revision</b>
                      <small>
                        {item.failureCode ?? "RECONCILIATION REQUIRED"}
                      </small>
                      <p>
                        Full refund ₱{(item.totalCentavos / 100).toFixed(2)} =
                        provider principal ₱
                        {(item.providerSubtotalCentavos / 100).toFixed(2)} +
                        CampusGig fee ₱
                        {(item.platformFeeCentavos / 100).toFixed(2)}
                      </p>
                    </div>
                    <div className="verify-actions">
                      <button
                        className="approve"
                        onClick={() => void refundStaleRevision(item)}
                      >
                        Refund stale payment
                      </button>
                    </div>
                  </div>
                ))}
                {refunds.length ? (
                  refunds.map((refund) => (
                    <div className="service-review-row" key={refund.id}>
                      <div className="service-review-main">
                        <b>
                          {refund.order?.orderNumber ??
                            refund.orderId.slice(0, 8)}
                        </b>
                        <small>
                          {refund.sourceType.replaceAll("_", " ")} ·{" "}
                          {refund.reasonCode.replaceAll("_", " ")}
                        </small>
                        <p>
                          Provider principal ₱
                          {(refund.providerPrincipalCentavos / 100).toFixed(2)}{" "}
                          + CampusGig fee ₱
                          {(refund.platformFeeCentavos / 100).toFixed(2)} = full
                          refund ₱
                          {(refund.refundTotalCentavos / 100).toFixed(2)}
                        </p>
                      </div>
                      <span className="school-status active">
                        {formatMarketplaceStatus(refund.status)}
                      </span>
                      {refund.failureCode && (
                        <small className="moderation-note">
                          {refund.failureCode}
                        </small>
                      )}
                      {[
                        "PENDING",
                        "PROCESSING",
                        "RECONCILIATION_REQUIRED",
                      ].includes(refund.status) && (
                        <div className="verify-actions">
                          <button onClick={() => void reconcileRefund(refund)}>
                            Reconcile with PayMongo
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="empty compact">
                    <h3>No marketplace refunds</h3>
                    <p>
                      Full refund requests and reconciliation cases appear here.
                    </p>
                  </div>
                )}
              </section>
              <section className="panel admin-panel admin-panel-services">
                <div className="panel-title">
                  <div>
                    <span className="kicker">MARKETPLACE SAFETY</span>
                    <h2>Service moderation queue</h2>
                  </div>
                  <span className="queue-count">
                    {serviceQueue.length} awaiting review
                  </span>
                </div>
                {serviceQueue.length ? (
                  serviceQueue.map((item) => (
                    <div className="service-review-row" key={item.id}>
                      <div className="service-review-main">
                        <b>{item.title}</b>
                        <small>
                          {item.category.name} ·{" "}
                          {item.deliveryMethod.replace("_", " ")}
                        </small>
                        <p>{item.description}</p>
                      </div>
                      <div>
                        <b>{item.provider.displayName}</b>
                        <small>
                          {item.provider.studentProfile?.school?.shortName ??
                            "Verified provider"}
                        </small>
                      </div>
                      <div className="service-review-package">
                        <small>
                          {isSinglePriceV2ServicePricingModel(item.pricingModel)
                            ? "SINGLE PRICE V2"
                            : "LEGACY PACKAGES"}
                        </small>
                        <b>
                          ₱
                          {Math.round(
                            (isSinglePriceV2ServicePricingModel(
                              item.pricingModel,
                            )
                              ? (item.basePriceCentavos ?? 0)
                              : (item.packages[0]?.priceCentavos ?? 0)) / 100,
                          ).toLocaleString()}
                        </b>
                        <small>
                          {isSinglePriceV2ServicePricingModel(item.pricingModel)
                            ? formatDeliveryMinutes(item.normalDeliveryMinutes)
                            : `${item.packages[0]?.deliveryDays ?? 0} day`}{" "}
                          delivery ·{" "}
                          {isSinglePriceV2ServicePricingModel(item.pricingModel)
                            ? (item.includedRevisionLimit ?? 0)
                            : (item.packages[0]?.revisionLimit ?? 0)}{" "}
                          revisions
                        </small>
                      </div>
                      <div className="verify-actions">
                        <button
                          className="reject"
                          onClick={() => moderateService(item, "reject")}
                        >
                          Reject
                        </button>
                        <button
                          className="approve"
                          onClick={() => moderateService(item, "approve")}
                        >
                          ✓ Publish
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty compact">
                    <span>◇</span>
                    <h3>No services awaiting review</h3>
                    <p>
                      Provider submissions will appear here before they become
                      public.
                    </p>
                  </div>
                )}
                {servicePage.hasMore && (
                  <button
                    className="primary-button"
                    disabled={loadingMore === "services"}
                    onClick={() => void loadMoreQueue("services")}
                  >
                    {loadingMore === "services"
                      ? "Loading..."
                      : "Load more services"}
                  </button>
                )}
              </section>
              <section className="panel admin-panel admin-panel-verifications">
                <div className="panel-title">
                  <div>
                    <span className="kicker">TRUST & SAFETY</span>
                    <h2>Student verification queue</h2>
                  </div>
                  <span className="queue-count">
                    {queue.length} awaiting review
                  </span>
                </div>
                {queue.length ? (
                  queue.map((item) => (
                    <div className="verify-row" key={item.id}>
                      <span className="avatar large">
                        {item.name
                          .split(" ")
                          .map((part) => part[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </span>
                      <div className="verify-name">
                        <b>{item.name}</b>
                        <small>
                          {item.program || "Program not provided"}
                          {item.yearLevel ? ` · Year ${item.yearLevel}` : ""}
                        </small>
                      </div>
                      <div>
                        <b>{item.school}</b>
                        <small>
                          Submitted{" "}
                          {new Date(item.submittedAt).toLocaleDateString()}
                        </small>
                      </div>
                      <button
                        className="document-chip"
                        onClick={() => openDocument(item)}
                      >
                        ▤ View student ID
                      </button>
                      <div className="verify-actions">
                        <button
                          className="reject"
                          onClick={() => review(item, "reject")}
                        >
                          Reject
                        </button>
                        <button
                          className="approve"
                          onClick={() => review(item, "approve")}
                        >
                          ✓ Approve
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty compact">
                    <span>◇</span>
                    <h3>No verification requests</h3>
                    <p>New student submissions will appear here.</p>
                  </div>
                )}
                {verificationPage.hasMore && (
                  <button
                    className="primary-button"
                    disabled={loadingMore === "verifications"}
                    onClick={() => void loadMoreQueue("verifications")}
                  >
                    {loadingMore === "verifications"
                      ? "Loading..."
                      : "Load more verifications"}
                  </button>
                )}
              </section>
            </div>
            <div
              className="admin-section-heading admin-management-heading"
              id="schools"
            >
              <div>
                <span className="kicker">CAMPUS NETWORK</span>
                <h2>Access and school management</h2>
              </div>
            </div>
            <div className="admin-school-grid">
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <span className="kicker">SCHOOL ADMINISTRATORS</span>
                    <h2>Verification access</h2>
                  </div>
                  <span className="queue-count">
                    {schoolAdmins.length} assigned
                  </span>
                </div>
                <form
                  className="school-admin-form"
                  onSubmit={assignSchoolAdmin}
                >
                  <label>
                    Existing account email
                    <input
                      type="email"
                      value={schoolAdminForm.email}
                      onChange={(event) =>
                        setSchoolAdminForm({
                          ...schoolAdminForm,
                          email: event.target.value,
                        })
                      }
                      placeholder="administrator@school.edu.ph"
                      required
                    />
                  </label>
                  <label>
                    Assigned school
                    <span className="admin-select-control">
                      <select
                        value={schoolAdminForm.schoolId}
                        onChange={(event) =>
                          setSchoolAdminForm({
                            ...schoolAdminForm,
                            schoolId: event.target.value,
                          })
                        }
                        required
                      >
                        <option value="">Select an active school</option>
                        {schools
                          .filter((school) => school.status === "ACTIVE")
                          .map((school) => (
                            <option key={school.id} value={school.id}>
                              {school.name}
                            </option>
                          ))}
                      </select>
                      <i aria-hidden="true" />
                    </span>
                  </label>
                  <button className="primary-button admin-assign-button">
                    Assign access
                  </button>
                </form>
                <div className="school-admin-list">
                  {schoolAdmins.map((item) => (
                    <div className="school-admin-row" key={item.userId}>
                      <div>
                        <b>{item.user.displayName}</b>
                        <small>
                          {item.user.email} · {item.school.shortName}
                        </small>
                      </div>
                      <button
                        className="reject"
                        onClick={() => removeSchoolAdmin(item)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {schoolAdmins.length === 0 && (
                    <p className="admin-empty-copy">
                      No school administrators assigned yet.
                    </p>
                  )}
                  {schoolAdminPage.hasMore && (
                    <button
                      className="primary-button"
                      disabled={loadingMore === "school-admins"}
                      onClick={() => void loadMoreQueue("school-admins")}
                    >
                      {loadingMore === "school-admins"
                        ? "Loading..."
                        : "Load more administrators"}
                    </button>
                  )}
                </div>
              </section>
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <span className="kicker">PARTICIPATING SCHOOLS</span>
                    <h2>School access</h2>
                  </div>
                  <div className="admin-school-title-actions">
                    <span className="queue-count">
                      {schools.length} registered
                    </span>
                    <button
                      type="button"
                      className="primary-button admin-add-school"
                      onClick={() => setSchoolDrawerOpen(true)}
                    >
                      Add school
                    </button>
                  </div>
                </div>
                <div className="school-admin-list admin-school-access-list">
                  {visibleSchools.map((school) => (
                    <div className="school-admin-row" key={school.id}>
                      <div>
                        <b>{school.name}</b>
                        <small>
                          {school.shortName} · {school.city}
                        </small>
                      </div>
                      <span
                        className={`school-status ${school.status?.toLowerCase()}`}
                      >
                        {school.status}
                      </span>
                      <select
                        value={school.status}
                        onChange={(event) =>
                          changeSchoolStatus(
                            school,
                            event.target.value as
                              | "PENDING"
                              | "ACTIVE"
                              | "DISABLED",
                          )
                        }
                      >
                        <option value="PENDING">Pending</option>
                        <option value="ACTIVE">Active</option>
                        <option value="DISABLED">Disabled</option>
                      </select>
                    </div>
                  ))}
                  {schools.length === 0 && (
                    <p className="admin-empty-copy">
                      No participating schools have been registered.
                    </p>
                  )}
                </div>
                {schools.length > SCHOOL_PAGE_SIZE && (
                  <nav
                    className="admin-school-pagination"
                    aria-label="Participating schools pages"
                  >
                    <button
                      type="button"
                      disabled={schoolPage === 1}
                      onClick={() => setSchoolPage((page) => page - 1)}
                    >
                      Previous
                    </button>
                    <span>
                      Page {schoolPage} of {schoolPageCount}
                    </span>
                    <button
                      type="button"
                      disabled={schoolPage === schoolPageCount}
                      onClick={() => setSchoolPage((page) => page + 1)}
                    >
                      Next
                    </button>
                  </nav>
                )}
              </section>
            </div>
            {schoolDrawerOpen && (
              <div
                className="admin-drawer-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget)
                    setSchoolDrawerOpen(false);
                }}
              >
                <aside
                  className="admin-school-drawer"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="add-school-title"
                >
                  <div className="admin-drawer-heading">
                    <div>
                      <span className="kicker">CAMPUS NETWORK</span>
                      <h2 id="add-school-title">Register a school</h2>
                      <p>Add a participating campus as pending for review.</p>
                    </div>
                    <button
                      ref={schoolDrawerCloseRef}
                      type="button"
                      aria-label="Close school form"
                      onClick={() => setSchoolDrawerOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  <form className="school-admin-form" onSubmit={addSchool}>
                    <label>
                      School name
                      <input
                        value={schoolForm.name}
                        onChange={(event) =>
                          setSchoolForm({
                            ...schoolForm,
                            name: event.target.value,
                          })
                        }
                        required
                        minLength={2}
                      />
                    </label>
                    <label>
                      Short name
                      <input
                        value={schoolForm.shortName}
                        onChange={(event) =>
                          setSchoolForm({
                            ...schoolForm,
                            shortName: event.target.value,
                          })
                        }
                        required
                        minLength={2}
                        maxLength={30}
                      />
                    </label>
                    <label>
                      Email domain <small>Optional</small>
                      <input
                        value={schoolForm.emailDomain}
                        onChange={(event) =>
                          setSchoolForm({
                            ...schoolForm,
                            emailDomain: event.target.value,
                          })
                        }
                        placeholder="school.edu.ph"
                      />
                    </label>
                    <label>
                      Address <small>Optional</small>
                      <input
                        value={schoolForm.address}
                        onChange={(event) =>
                          setSchoolForm({
                            ...schoolForm,
                            address: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="admin-drawer-actions">
                      <button
                        type="button"
                        className="outline-button"
                        onClick={() => setSchoolDrawerOpen(false)}
                      >
                        Cancel
                      </button>
                      <button className="primary-button">Add as pending</button>
                    </div>
                  </form>
                </aside>
              </div>
            )}
          </>
        )}
      </main>
      {selectedDispute && (
        <div
          className="admin-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedDispute(null);
          }}
        >
          <section
            className="admin-dispute-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dispute-dialog-title"
          >
            <header className="admin-dispute-dialog-header">
              <div>
                <span className="kicker">DISPUTE DETAILS</span>
                <h2 id="dispute-dialog-title">
                  Order {selectedDispute.orderId.slice(0, 8)}
                </h2>
                <p>Opened by {selectedDispute.openedBy.displayName}</p>
              </div>
              <button
                ref={disputeDialogCloseRef}
                type="button"
                className="admin-modal-close"
                aria-label="Close dispute details"
                onClick={() => setSelectedDispute(null)}
              >
                ×
              </button>
            </header>

            <div className="admin-dispute-dialog-summary">
              <div>
                <span>Reason</span>
                <strong>{selectedDispute.reason.replaceAll("_", " ")}</strong>
              </div>
              <span className="school-status active">
                {formatMarketplaceStatus(selectedDispute.status)}
              </span>
            </div>

            <section className="admin-dispute-dialog-section">
              <h3>Report</h3>
              <p>{selectedDispute.details}</p>
            </section>

            <div className="admin-dispute-facts">
              <section>
                <span>Response requested</span>
                <strong>
                  {selectedDispute.responseRequestedFrom ?? "None"}
                </strong>
                {selectedDispute.responseDeadlineAt && (
                  <small>
                    Due{" "}
                    {new Date(
                      selectedDispute.responseDeadlineAt,
                    ).toLocaleString()}
                  </small>
                )}
              </section>
              <section>
                <span>Affected earnings</span>
                <strong>
                  {selectedDispute.affectedEarnings.length
                    ? selectedDispute.affectedEarnings
                        .map(
                          (affected) =>
                            `${affected.providerEarning.sourceType}: ${affected.preFreezeStatus} → ${affected.providerEarning.status}`,
                        )
                        .join(", ")
                    : "None recorded"}
                </strong>
              </section>
            </div>

            <section className="admin-dispute-dialog-section">
              <h3>Evidence</h3>
              {selectedDispute.evidence.length ? (
                <div className="admin-dispute-evidence">
                  {selectedDispute.evidence.map((evidence) => (
                    <button
                      type="button"
                      className="link-button"
                      key={evidence.id}
                      onClick={() =>
                        void downloadAdminEvidence(
                          selectedDispute.id,
                          evidence.id,
                          evidence.originalName,
                        )
                      }
                    >
                      {evidence.originalName}
                    </button>
                  ))}
                </div>
              ) : (
                <p>No uploaded evidence.</p>
              )}
            </section>

            <section className="admin-dispute-dialog-section">
              <h3>Responses</h3>
              {selectedDispute.responses.length ? (
                <ul className="admin-dispute-response-list">
                  {selectedDispute.responses.map((response) => (
                    <li key={response.id}>
                      <strong>{response.responder.displayName}</strong>
                      <p>{response.details}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No responses have been submitted.</p>
              )}
            </section>

            <section className="admin-dispute-dialog-section">
              <h3>Timeline</h3>
              <p>
                {selectedDispute.timeline
                  .map((event) => event.type.replaceAll("_", " "))
                  .join(" → ") || "No timeline events recorded."}
              </p>
            </section>

            {selectedDispute.resolutionNote && (
              <section className="admin-dispute-resolution">
                <span>Resolution</span>
                <p>{selectedDispute.resolutionNote}</p>
              </section>
            )}

            <footer className="admin-dispute-dialog-footer">
              <p>
                {"Delivery access records are supporting evidence only; access does not prove acceptance."}
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => setSelectedDispute(null)}
              >
                Done
              </button>
            </footer>
          </section>
        </div>
      )}
      {appDialog.dialog}
    </div>
  );
}
