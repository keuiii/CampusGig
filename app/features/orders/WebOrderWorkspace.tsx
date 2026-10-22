"use client";

import {
  FormEvent,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { io } from "socket.io-client";
import { realtimeSocketEnabled } from "../realtime/realtime-config";
import { Icon } from "../../components/brand";
import { useAppDialog } from "../../components/app-dialog";
import { SkeletonCollection } from "../../components/Skeletons";
import { api } from "../../lib/api";
import { apiUrl } from "../../lib/http-client";
import type {
  DisputeReason,
  ExtraRevisionQuote,
  MarketplaceOrder,
  OrderDispute,
  OrderPayment,
  OrderMessage,
  OrderWorkspace,
  RefundEligibility,
  MarketplaceRefundReason,
} from "../../types";
import { formatCampusDate } from "../../lib/date";
import { formatMarketplaceStatus } from "../../lib/marketplace-presentation";
import {
  formatDeliveryMinutes,
  isSinglePriceV2OrderPricingModel,
} from "../../lib/pricing-model";
import {
  completionExplanation,
  hasActiveReviewWindow,
  reviewDeadlineLabel,
  reviewTimeRemaining,
} from "./order-review";

const campusTimeZone = "Asia/Manila";

function formatMoney(centavos: number, currency: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
  }).format(centavos / 100);
}

function campusDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: campusTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function messageTimeLabel(value: string) {
  return new Date(value).toLocaleTimeString([], {
    timeZone: campusTimeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function messageDateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);

  const day = campusDateKey(date);
  const dayLabel =
    day === campusDateKey(today)
      ? "Today"
      : day === campusDateKey(yesterday)
        ? "Yesterday"
        : date.toLocaleDateString([], {
            timeZone: campusTimeZone,
            month: "short",
            day: "numeric",
            year:
              new Intl.DateTimeFormat("en", {
                timeZone: campusTimeZone,
                year: "numeric",
              }).format(date) ===
              new Intl.DateTimeFormat("en", {
                timeZone: campusTimeZone,
                year: "numeric",
              }).format(today)
                ? undefined
                : "numeric",
          });

  return `${dayLabel} at ${messageTimeLabel(value)}`;
}

export function WebOrderWorkspace({
  token,
  order,
  perspective = "provider",
  onClose,
  onChanged,
}: {
  token: string;
  order: MarketplaceOrder;
  perspective?: "client" | "provider";
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const appDialog = useAppDialog();
  const [detail, setDetail] = useState<OrderWorkspace | null>(null);
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [messageFiles, setMessageFiles] = useState<File[]>([]);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [deliveryFiles, setDeliveryFiles] = useState<File[]>([]);
  const [submittingDelivery, setSubmittingDelivery] = useState(false);
  const [revisionInstructions, setRevisionInstructions] = useState("");
  const [correctionInstructions, setCorrectionInstructions] = useState("");
  const [extraRevisionInstructions, setExtraRevisionInstructions] =
    useState("");
  const [extraRevisionQuote, setExtraRevisionQuote] =
    useState<ExtraRevisionQuote | null>(null);
  const [openingExtraRevisionCheckout, setOpeningExtraRevisionCheckout] =
    useState(false);
  const [rating, setRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [acting, setActing] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [peerRead, setPeerRead] = useState(false);
  const [dispute, setDispute] = useState<OrderDispute | null>(null);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState<DisputeReason>(
    "SERVICE_NOT_DELIVERED",
  );
  const [disputeDetails, setDisputeDetails] = useState("");
  const [disputeFiles, setDisputeFiles] = useState<File[]>([]);
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [responseDetails, setResponseDetails] = useState("");
  const [responseFiles, setResponseFiles] = useState<File[]>([]);
  const [additionalEvidence, setAdditionalEvidence] = useState<File[]>([]);
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [payments, setPayments] = useState<OrderPayment[]>([]);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [refundEligibility, setRefundEligibility] =
    useState<RefundEligibility | null>(null);
  const [requestingRefund, setRequestingRefund] = useState(false);
  const [paymentVerificationPending, setPaymentVerificationPending] =
    useState(false);
  const [reviewClock, setReviewClock] = useState(() => Date.now());
  const refreshSequence = useRef(0);
  const deliveryAttempt = useRef<{
    signature: string;
    clientRequestId: string;
  } | null>(null);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const [
      orderResult,
      messageResult,
      disputeResult,
      paymentResult,
      refundEligibilityResult,
    ] =
      await Promise.all([
        api.order(token, order.id),
        api.messages(token, order.id),
        api.orderDispute(token, order.id),
        api.orderPayments(token, order.id),
        api.refundEligibility(token, order.id),
      ]);
    if (sequence !== refreshSequence.current) return;
    setDetail(orderResult.data);
    setMessages(messageResult.data);
    setDispute(disputeResult.data);
    setPayments(paymentResult.data);
    setRefundEligibility(refundEligibilityResult.data);
    const pendingRevisionOrderId = window.sessionStorage.getItem(
      "campusgig.revisionPaymentReturnOrderId",
    );
    const latestRevisionPurchase = orderResult.data.revisionPurchases?.[0];
    if (
      pendingRevisionOrderId === order.id &&
      latestRevisionPurchase &&
      (latestRevisionPurchase.activationStatus !== "PENDING" ||
        ["FAILED", "CANCELLED"].includes(latestRevisionPurchase.paymentStatus))
    )
      window.sessionStorage.removeItem(
        "campusgig.revisionPaymentReturnOrderId",
      );
    if (
      perspective === "client" &&
      orderResult.data.status === "SUBMITTED" &&
      orderResult.data.reviewActionable &&
      orderResult.data.revisionsUsed >= orderResult.data.revisionLimit
    ) {
      try {
        const quote = await api.extraRevisionQuote(token, order.id);
        if (sequence === refreshSequence.current)
          setExtraRevisionQuote(quote.data);
      } catch {
        if (sequence === refreshSequence.current) setExtraRevisionQuote(null);
      }
    } else {
      setExtraRevisionQuote(null);
    }
    if (paymentResult.data[0]?.status === "PAID") {
      window.sessionStorage.removeItem("campusgig.paymentReturnOrderId");
      setPaymentVerificationPending(false);
    }
  }, [order.id, perspective, token]);
  useEffect(() => {
    setPaymentVerificationPending(
      window.sessionStorage.getItem("campusgig.paymentReturnOrderId") ===
        order.id,
    );
    void refresh();
    const endpoint = apiUrl();
    const socket = endpoint && realtimeSocketEnabled()
      ? io(`${new URL(endpoint).origin}/realtime`, {
          auth: { token },
          transports: ["websocket", "polling"],
          reconnection: true,
        })
      : null;
    socket?.on("connect", () => {
      setRealtimeConnected(true);
      socket.emit("conversation:subscribe", { orderId: order.id });
      void refresh();
    });
    socket?.on("disconnect", () => setRealtimeConnected(false));
    socket?.on(
      "message:created",
      (event: { orderId: string; message: OrderMessage }) => {
        if (event.orderId !== order.id) return;
        setMessages((items) =>
          items.some((item) => item.id === event.message.id)
            ? items
            : [...items, event.message],
        );
      },
    );
    socket?.on("conversation:read", (event: { orderId: string }) => {
      if (event.orderId === order.id) setPeerRead(true);
    });
    const refreshOrder = (event: { orderId?: string }) => {
      if (event.orderId === order.id) void refresh();
    };
    socket?.on("order:changed", refreshOrder);
    socket?.on("payment:changed", refreshOrder);
    const timer = window.setInterval(() => void refresh(), 20000);
    const reviewTimer = window.setInterval(
      () => setReviewClock(Date.now()),
      30000,
    );
    return () => {
      window.clearInterval(timer);
      window.clearInterval(reviewTimer);
      socket?.disconnect();
    };
  }, [order.id, refresh, token]);
  async function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if ((!body && !messageFiles.length) || sending) return;
    setSending(true);
    try {
      const result = messageFiles.length
        ? await api.sendMessageAttachments(token, order.id, messageFiles, body)
        : await api.sendMessage(token, order.id, body);
      setMessages((items) =>
        items.some((item) => item.id === result.data.id)
          ? items
          : [...items, result.data],
      );
      setPeerRead(false);
      setDraft("");
      setMessageFiles([]);
    } catch (error) {
      await appDialog.alert({
        title: "Message not sent",
        message:
          error instanceof Error ? error.message : "Unable to send message",
        confirmLabel: "Try again",
        tone: "danger",
      });
    } finally {
      setSending(false);
    }
  }
  async function submitDelivery(event: FormEvent) {
    event.preventDefault();
    if (
      !detail ||
      deliveryNote.trim().length < 3 ||
      !deliveryFiles.length ||
      submittingDelivery
    )
      return;
    if (
      !(await appDialog.confirm({
        title: "Submit these deliverables?",
        message: `The client will be notified that ${deliveryFiles.length} file${deliveryFiles.length === 1 ? " is" : "s are"} ready for review.`,
        confirmLabel: "Submit delivery",
        cancelLabel: "Review files",
      }))
    )
      return;
    setSubmittingDelivery(true);
    try {
      const signature = JSON.stringify({
        note: deliveryNote.trim(),
        files: deliveryFiles.map((file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
        })),
      });
      if (deliveryAttempt.current?.signature !== signature)
        deliveryAttempt.current = {
          signature,
          clientRequestId: globalThis.crypto.randomUUID(),
        };
      const result = await api.deliverOrder(
        token,
        detail.id,
        deliveryNote.trim(),
        deliveryFiles,
        deliveryAttempt.current.clientRequestId,
      );
      deliveryAttempt.current = null;
      setDeliveryNote("");
      setDeliveryFiles([]);
      await appDialog.alert({
        title:
          `Delivery version ${result.data.currentDeliverySubmission?.version ?? ""} submitted`.trim(),
        message: result.message,
      });
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      await appDialog.alert({
        title: "Delivery not submitted",
        message:
          error instanceof Error ? error.message : "Unable to submit delivery",
        confirmLabel: "Try again",
        tone: "danger",
      });
    } finally {
      setSubmittingDelivery(false);
    }
  }
  async function downloadFile(fileId: string, originalName: string) {
    try {
      const blob = await api.orderFile(token, order.id, fileId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = originalName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      await appDialog.alert({
        title: "Download unavailable",
        message:
          error instanceof Error ? error.message : "Unable to download file",
        tone: "danger",
      });
    }
  }
  async function clientAction(action: "complete" | "revision" | "review") {
    if (!detail || acting) return;
    const actionCopy = {
      complete: {
        title: "Approve this delivery?",
        message:
          "This completes the order and confirms that the delivered work meets your requirements.",
        confirmLabel: "Complete order",
      },
      revision: {
        title: "Request this revision?",
        message:
          "Your revision instructions will be sent to the provider and recorded in the order timeline.",
        confirmLabel: "Request revision",
      },
      review: {
        title: "Publish this review?",
        message:
          "Your rating and comments will be attached to this completed order.",
        confirmLabel: "Publish review",
      },
    }[action];
    if (
      !(await appDialog.confirm({
        ...actionCopy,
        cancelLabel: "Review again",
      }))
    )
      return;
    setActing(true);
    try {
      const result =
        action === "complete"
          ? await api.completeOrder(token, detail.id)
          : action === "revision"
            ? await api.requestOrderRevision(
                token,
                detail.id,
                revisionInstructions.trim(),
              )
            : await api.reviewOrder(token, detail.id, {
                overallRating: rating,
                qualityRating: rating,
                communicationRating: rating,
                timelinessRating: rating,
                comment: reviewComment.trim() || undefined,
              });
      setRevisionInstructions("");
      setReviewComment("");
      await appDialog.alert({
        title:
          action === "complete"
            ? "Order completed"
            : action === "revision"
              ? "Revision requested"
              : "Review published",
        message: result.message,
      });
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      await appDialog.alert({
        title: "Order not updated",
        message:
          error instanceof Error ? error.message : "Unable to update the order",
        tone: "danger",
      });
    } finally {
      setActing(false);
    }
  }
  async function submitDispute(event: FormEvent) {
    event.preventDefault();
    if (submittingDispute || disputeDetails.trim().length < 10) return;
    if (
      !(await appDialog.confirm({
        title: "Submit this report?",
        message:
          "CampusGig administrators will review the order, delivery, payment, and conversation history.",
        confirmLabel: "Submit report",
        cancelLabel: "Review details",
        tone: "danger",
      }))
    )
      return;
    setSubmittingDispute(true);
    try {
      const result = await api.openOrderDispute(
        token,
        order.id,
        disputeReason,
        disputeDetails.trim(),
        disputeFiles,
      );
      setDispute(result.data);
      setShowDisputeForm(false);
      setDisputeDetails("");
      setDisputeFiles([]);
      await appDialog.alert({
        title: "Report submitted",
        message: result.message,
      });
    } catch (error) {
      await appDialog.alert({
        title: "Report not submitted",
        message:
          error instanceof Error
            ? error.message
            : "Unable to submit the report",
        tone: "danger",
      });
    } finally {
      setSubmittingDispute(false);
    }
  }
  async function submitDisputeResponse(event: FormEvent) {
    event.preventDefault();
    if (!dispute || submittingResponse || responseDetails.trim().length < 10)
      return;
    setSubmittingResponse(true);
    try {
      const result = await api.submitDisputeResponse(
        token,
        order.id,
        dispute.id,
        responseDetails.trim(),
        responseFiles,
      );
      setDispute(result.data);
      setResponseDetails("");
      setResponseFiles([]);
      await appDialog.alert({
        title: "Response submitted",
        message: result.message,
      });
    } catch (error) {
      await appDialog.alert({
        title: "Response not submitted",
        message:
          error instanceof Error ? error.message : "Unable to submit response",
        tone: "danger",
      });
    } finally {
      setSubmittingResponse(false);
    }
  }
  async function addDisputeEvidence() {
    if (!dispute || submittingResponse || !additionalEvidence.length) return;
    setSubmittingResponse(true);
    try {
      const result = await api.addDisputeEvidence(
        token,
        order.id,
        dispute.id,
        additionalEvidence,
      );
      setDispute(result.data);
      setAdditionalEvidence([]);
      await appDialog.alert({
        title: "Evidence added",
        message: result.message,
      });
    } catch (error) {
      await appDialog.alert({
        title: "Evidence not added",
        message:
          error instanceof Error ? error.message : "Unable to add evidence",
        tone: "danger",
      });
    } finally {
      setSubmittingResponse(false);
    }
  }
  async function downloadDisputeEvidence(
    evidenceId: string,
    originalName: string,
  ) {
    if (!dispute) return;
    try {
      const blob = await api.disputeEvidence(
        token,
        order.id,
        dispute.id,
        evidenceId,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = originalName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      await appDialog.alert({
        title: "Evidence unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Unable to download evidence",
        tone: "danger",
      });
    }
  }
  async function requestCorrectionClaim() {
    if (!detail || acting || correctionInstructions.trim().length < 10) return;
    if (
      !(await appDialog.confirm({
        title: "Ask the provider to acknowledge a correction?",
        message:
          "Use this only when the delivery does not meet the original requirements. The provider must acknowledge it before a free correction becomes active.",
        confirmLabel: "Send correction claim",
        cancelLabel: "Review details",
      }))
    )
      return;
    setActing(true);
    try {
      const result = await api.requestProviderCorrection(
        token,
        detail.id,
        correctionInstructions.trim(),
      );
      setCorrectionInstructions("");
      await appDialog.alert({
        title: "Correction claim recorded",
        message: result.message,
      });
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      await appDialog.alert({
        title: "Correction claim not sent",
        message:
          error instanceof Error ? error.message : "Unable to record the claim",
        tone: "danger",
      });
    } finally {
      setActing(false);
    }
  }

  async function decideCorrection(revisionId: string, accepted: boolean) {
    if (acting) return;
    setActing(true);
    try {
      const result = await api.decideProviderCorrection(
        token,
        order.id,
        revisionId,
        accepted,
      );
      await appDialog.alert({
        title: accepted ? "Correction acknowledged" : "Claim declined",
        message: result.message,
      });
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      await appDialog.alert({
        title: "Correction decision not saved",
        message:
          error instanceof Error
            ? error.message
            : "Unable to save the decision",
        tone: "danger",
      });
    } finally {
      setActing(false);
    }
  }

  async function openExtraRevisionCheckout() {
    if (
      openingExtraRevisionCheckout ||
      extraRevisionInstructions.trim().length < 10
    )
      return;
    const popup = window.open("", "campusgig-paymongo-revision");
    setOpeningExtraRevisionCheckout(true);
    try {
      const result = await api.createExtraRevisionCheckout(
        token,
        order.id,
        extraRevisionInstructions.trim(),
      );
      window.sessionStorage.setItem(
        "campusgig.revisionPaymentReturnOrderId",
        order.id,
      );
      if (popup) popup.location.href = result.checkoutUrl;
      else window.location.assign(result.checkoutUrl);
    } catch (error) {
      popup?.close();
      await appDialog.alert({
        title: "Extra-revision checkout unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Unable to open the extra-revision checkout",
        tone: "danger",
      });
    } finally {
      setOpeningExtraRevisionCheckout(false);
    }
  }
  async function openCheckout() {
    if (openingCheckout) return;
    const popup = window.open("", "campusgig-paymongo");
    setOpeningCheckout(true);
    try {
      const result = await api.createPaymentCheckout(token, order.id);
      window.sessionStorage.setItem("campusgig.paymentReturnOrderId", order.id);
      setPaymentVerificationPending(true);
      if (popup) popup.location.href = result.checkoutUrl;
      else window.location.assign(result.checkoutUrl);
    } catch (error) {
      popup?.close();
      await appDialog.alert({
        title: "Payment page unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Unable to open PayMongo checkout",
        confirmLabel: "Try again",
        tone: "danger",
      });
    } finally {
      setOpeningCheckout(false);
    }
  }
  async function checkPaymentStatus() {
    if (checkingPayment) return;
    setCheckingPayment(true);
    try {
      await Promise.all([refresh(), onChanged()]);
      const result = await api.orderPayments(token, order.id);
      setPayments(result.data);
      if (result.data[0]?.status === "PAID") {
        window.sessionStorage.removeItem("campusgig.paymentReturnOrderId");
        setPaymentVerificationPending(false);
      } else {
        setPaymentVerificationPending(false);
        window.sessionStorage.removeItem("campusgig.paymentReturnOrderId");
      }
    } catch (error) {
      await appDialog.alert({
        title: "Payment status unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Unable to verify payment status",
        confirmLabel: "Try again",
        tone: "danger",
      });
    } finally {
      setCheckingPayment(false);
    }
  }
  async function requestFullRefund(reason: Extract<
    MarketplaceRefundReason,
    "PAID_NOT_STARTED" | "MISSED_RUSH_DEADLINE"
  >) {
    if (requestingRefund) return;
    const total = refundEligibility?.payment?.refundTotalCentavos ?? 0;
    const confirmed = await appDialog.confirm({
      title: "Request full refund?",
      message: `This requests the full ${(total / 100).toLocaleString(undefined, { style: "currency", currency: refundEligibility?.payment?.currency ?? "PHP" })} payment, including the CampusGig service fee. Work and delivery will be blocked while PayMongo processes it.`,
      confirmLabel: "Request full refund",
      tone: "danger",
    });
    if (!confirmed) return;
    setRequestingRefund(true);
    try {
      const result = await api.requestFullRefund(token, order.id, reason);
      await Promise.all([refresh(), onChanged()]);
      await appDialog.alert({
        title:
          result.data.status === "SUCCEEDED"
            ? "Refund completed"
            : "Refund submitted",
        message:
          result.data.status === "SUCCEEDED"
            ? "PayMongo confirmed the full refund. Provider earnings and the CampusGig fee were reversed."
            : "The full refund is being processed. CampusGig will not mark it complete until PayMongo confirms success.",
      });
    } catch (error) {
      await appDialog.alert({
        title: "Refund needs attention",
        message:
          error instanceof Error
            ? error.message
            : "The refund could not be confirmed. CampusGig will preserve it for reconciliation.",
        tone: "danger",
      });
      await refresh();
    } finally {
      setRequestingRefund(false);
    }
  }
  const active = detail ?? order;
  const v2Order = isSinglePriceV2OrderPricingModel(active.pricingModel);
  const paymentStatus = payments[0]?.status ?? active.paymentStatus ?? null;
  const paymentConfirmed = paymentStatus === "PAID";
  const refund = payments[0]?.refunds?.[0] ?? refundEligibility?.refund ?? null;
  const refundInProgress =
    paymentStatus === "REFUND_PENDING" ||
    (["REQUESTED", "PENDING", "PROCESSING", "RECONCILIATION_REQUIRED"] as string[]).includes(
      refund?.status ?? "",
    );
  const paymentCanRecover = [
    "ACCEPTED",
    "IN_PROGRESS",
    "REVISION_REQUESTED",
    "SUBMITTED",
    "COMPLETED",
  ].includes(active.status);
  const canDeliver =
    perspective === "provider" &&
    paymentConfirmed &&
    (active.status === "IN_PROGRESS" || active.status === "REVISION_REQUESTED");
  const canAccessFiles = perspective === "provider" || paymentConfirmed;
  const deliverySubmissions = active.deliverySubmissions ?? [];
  const legacyDeliveryFiles = (active.files ?? []).filter((file) =>
    ["DELIVERABLE", "REVISION"].includes(file.purpose),
  );
  const counterparty = perspective === "client" ? order.provider : order.client;
  const activeReviewWindow = hasActiveReviewWindow(active);
  const reviewRemaining = reviewTimeRemaining(
    active.reviewDeadlineAt,
    reviewClock,
  );
  const reviewDeadline = reviewDeadlineLabel(active.reviewDeadlineAt);
  const completedExplanation = completionExplanation(active);
  const disputeActive = dispute
    ? [
        "OPEN",
        "WAITING_FOR_CLIENT",
        "WAITING_FOR_PROVIDER",
        "READY_FOR_REVIEW",
        "UNDER_REVIEW",
      ].includes(dispute.status)
    : false;
  const currentParty = perspective === "client" ? "CLIENT" : "PROVIDER";
  const canRespondToDispute =
    disputeActive && dispute?.responseRequestedFrom === currentParty;
  const latestRevisionPurchase = active.revisionPurchases?.[0] ?? null;
  const pendingCorrectionClaim = active.revisions.some(
    (revision) =>
      revision.type === "PROVIDER_CORRECTION" &&
      revision.status === "AWAITING_PROVIDER_ACKNOWLEDGEMENT",
  );
  return createPortal(
    <div
      className="workspace-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Order workspace ${order.orderNumber}`}
    >
      <div className="web-workspace">
        <header>
          <div>
            <span className="kicker">ORDER WORKSPACE</span>
            <h2>{order.title}</h2>
            <small>
              {order.orderNumber} · {formatMarketplaceStatus(active.status)}
            </small>
          </div>
          <button onClick={onClose} aria-label="Close order workspace">
            ×
          </button>
        </header>
        <div className="web-workspace-grid">
          <aside>
            <section>
              <h3>Project requirements</h3>
              <p>{order.requirements}</p>
              <div className="workspace-facts">
                <span>
                  <small>
                    {perspective === "client" ? "PROVIDER" : "CLIENT"}
                  </small>
                  <b>{counterparty.displayName}</b>
                </span>
                <span>
                  <small>{v2Order ? "SELECTED DELIVERY" : "PACKAGE"}</small>
                  <b>
                    {v2Order
                      ? active.deliveryOption === "NORMAL"
                        ? `Normal · ${formatDeliveryMinutes(active.deliveryDurationMinutes)}`
                        : `${formatDeliveryMinutes(active.deliveryDurationMinutes)} Rush`
                      : (active.package?.name ?? "Legacy package")}
                  </b>
                </span>
                <span>
                  <small>REVISIONS</small>
                  <b>
                    {active.revisionsUsed}/{active.revisionLimit}
                  </b>
                </span>
                <span>
                  <small>
                    {v2Order && !active.dueAt
                      ? "DEADLINE"
                      : active.status === "REQUESTED"
                        ? "REQUESTED DELIVERY"
                        : "DUE"}
                  </small>
                  <b>
                    {active.dueAt
                      ? formatCampusDate(active.dueAt)
                      : "Starts after payment confirmation"}
                  </b>
                </span>
              </div>
            </section>
            {active.revisions?.length > 0 && (
              <section>
                <h3>Revision instructions</h3>
                {active.revisions.map((revision) => (
                  <div className="workspace-revision" key={revision.id}>
                    <b>
                      Revision {revision.sequenceNumber} ·{" "}
                      {(revision.type ?? "LEGACY").replaceAll("_", " ")} ·{" "}
                      {formatMarketplaceStatus(revision.status)}
                    </b>
                    <p>{revision.instructions}</p>
                    {revision.revisionDeadlineAt && (
                      <small>
                        Provider deadline:{" "}
                        {formatCampusDate(revision.revisionDeadlineAt)}
                        {Date.parse(revision.revisionDeadlineAt) < Date.now()
                          ? " · OVERDUE"
                          : ""}
                      </small>
                    )}
                    {perspective === "provider" &&
                      revision.type === "PAID_EXTRA" &&
                      revision.purchase && (
                        <small>
                          Extra earning:{" "}
                          {formatMoney(
                            revision.purchase.providerSubtotalCentavos,
                            revision.purchase.currency,
                          )}{" "}
                          · {revision.purchase.paymentStatus}
                        </small>
                      )}
                    {perspective === "provider" &&
                      revision.type === "PROVIDER_CORRECTION" &&
                      revision.status ===
                        "AWAITING_PROVIDER_ACKNOWLEDGEMENT" && (
                        <div className="revision-decision-actions">
                          <button
                            disabled={acting}
                            onClick={() =>
                              void decideCorrection(revision.id, true)
                            }
                          >
                            Acknowledge correction
                          </button>
                          <button
                            disabled={acting}
                            onClick={() =>
                              void decideCorrection(revision.id, false)
                            }
                          >
                            Decline · client may dispute
                          </button>
                        </div>
                      )}
                  </div>
                ))}
              </section>
            )}
            {canDeliver && (
              <section>
                <h3>
                  {active.status === "REVISION_REQUESTED"
                    ? "Submit revised work"
                    : "Submit completed work"}
                </h3>
                <form className="delivery-form" onSubmit={submitDelivery}>
                  <textarea
                    value={deliveryNote}
                    onChange={(event) => setDeliveryNote(event.target.value)}
                    maxLength={1000}
                    placeholder="Tell the client what you completed…"
                    required
                  />
                  <label>
                    Attach up to five files
                    <input
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.webp,.pdf,.zip,.docx,.xlsx"
                      onChange={(event) =>
                        setDeliveryFiles(
                          Array.from(event.target.files ?? []).slice(0, 5),
                        )
                      }
                    />
                  </label>
                  {deliveryFiles.length > 0 && (
                    <small>
                      {deliveryFiles.map((file) => file.name).join(" · ")}
                    </small>
                  )}
                  <button
                    disabled={
                      submittingDelivery ||
                      deliveryNote.trim().length < 3 ||
                      !deliveryFiles.length
                    }
                  >
                    {submittingDelivery ? "Uploading…" : "Submit delivery →"}
                  </button>
                </form>
              </section>
            )}
            {deliverySubmissions.length > 0 && canAccessFiles && (
              <section className="delivery-history">
                <h3>Delivery history</h3>
                <p className="delivery-access-policy">
                  Downloading a file does not automatically accept the order.
                </p>
                {deliverySubmissions.map((submission) => (
                  <article
                    className={`delivery-version-card${submission.isCurrent ? " current" : ""}`}
                    key={submission.id}
                  >
                    <header>
                      <b>Version {submission.version}</b>
                      {submission.isCurrent && <span>Current</span>}
                      <time>
                        {new Date(submission.submittedAt).toLocaleString()}
                      </time>
                    </header>
                    <p>{submission.note || "No delivery note was recorded."}</p>
                    <div className="workspace-files">
                      {submission.files.map((file) => (
                        <button
                          key={file.id}
                          onClick={() =>
                            void downloadFile(file.id, file.originalName)
                          }
                        >
                          <span>⇩</span>
                          <b>{file.originalName}</b>
                          <small>
                            {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB
                          </small>
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </section>
            )}
            {!deliverySubmissions.length &&
              legacyDeliveryFiles.length > 0 &&
              canAccessFiles && (
                <section>
                  <h3>Legacy delivery files</h3>
                  <p className="delivery-access-policy">
                    Downloading a file does not automatically accept the order.
                  </p>
                  <div className="workspace-files">
                    {legacyDeliveryFiles.map((file) => (
                      <button
                        key={file.id}
                        onClick={() =>
                          void downloadFile(file.id, file.originalName)
                        }
                      >
                        <span>⇩</span>
                        <b>{file.originalName}</b>
                        <small>
                          {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB ·{" "}
                          {file.purpose.replaceAll("_", " ")}
                        </small>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            {activeReviewWindow && (
              <section className="delivery-review-window" aria-live="polite">
                <span className="kicker">48-HOUR DELIVERY REVIEW</span>
                <h3>
                  {perspective === "provider"
                    ? "Awaiting client review"
                    : reviewRemaining}
                </h3>
                {perspective === "provider" && (
                  <strong>{reviewRemaining}</strong>
                )}
                <p>
                  Review by <b>{reviewDeadline}</b>. You have 48 hours after
                  each delivery to review the work. If no action is taken before
                  the review deadline and no dispute or revision is active, the
                  order may be completed automatically.
                </p>
                {active.reviewState === "BLOCKED_BY_DISPUTE" && (
                  <strong>
                    Automatic completion is paused while the dispute is active.
                  </strong>
                )}
                {perspective === "provider" && (
                  <small>
                    Your earning remains pending while the client reviews this
                    delivery.
                  </small>
                )}
              </section>
            )}
            {active.status === "COMPLETED" && completedExplanation && (
              <section className="delivery-review-window completed">
                <span className="kicker">ORDER COMPLETED</span>
                <h3>
                  {active.completionSource === "AUTO_REVIEW_TIMEOUT"
                    ? "Completed automatically after the review period"
                    : "Delivery accepted"}
                </h3>
                <p>{completedExplanation}</p>
              </section>
            )}
            {perspective === "client" &&
              active.status === "SUBMITTED" &&
              paymentConfirmed && (
                <section className="client-order-actions">
                  <span className="kicker">REVIEW DELIVERY</span>
                  <h3>Is the work ready?</h3>
                  <p>
                    Download and check the submitted files. Accept the delivery
                    when it is complete, or provide clear revision instructions.
                    Downloading a file does not automatically accept the order.
                    The order completes automatically when the 48-hour review
                    period ends unless a revision or dispute is active.
                  </p>
                  <button
                    className="accept-order-button"
                    disabled={acting}
                    onClick={() => void clientAction("complete")}
                  >
                    {acting ? "Updating…" : "✓ Accept delivery"}
                  </button>
                  {active.revisionsUsed < active.revisionLimit && (
                    <div className="revision-request-form">
                      <b>
                        {active.revisionLimit - active.revisionsUsed} included
                        revision
                        {active.revisionLimit - active.revisionsUsed === 1
                          ? ""
                          : "s"}{" "}
                        remaining
                      </b>
                      <textarea
                        value={revisionInstructions}
                        onChange={(event) =>
                          setRevisionInstructions(event.target.value)
                        }
                        maxLength={2000}
                        placeholder="Describe exactly what needs to be changed…"
                      />
                      <button
                        disabled={
                          acting || revisionInstructions.trim().length < 10
                        }
                        onClick={() => void clientAction("revision")}
                      >
                        Request Included Revision
                      </button>
                    </div>
                  )}
                  {active.revisionsUsed >= active.revisionLimit &&
                    extraRevisionQuote && (
                      <div className="extra-revision-card">
                        <span className="kicker">OPTIONAL EXTRA REVISION</span>
                        <h3>Purchase Extra Revision</h3>
                        <p>
                          Provider revision price{" "}
                          <b>
                            {formatMoney(
                              extraRevisionQuote.providerSubtotalCentavos,
                              extraRevisionQuote.currency,
                            )}
                          </b>
                          , CampusGig fee{" "}
                          <b>
                            {formatMoney(
                              extraRevisionQuote.platformFeeCentavos,
                              extraRevisionQuote.currency,
                            )}
                          </b>
                          , total{" "}
                          <b>
                            {formatMoney(
                              extraRevisionQuote.clientTotalCentavos,
                              extraRevisionQuote.currency,
                            )}
                          </b>
                          . Provider turnaround:{" "}
                          {formatDeliveryMinutes(
                            extraRevisionQuote.turnaroundMinutes,
                          )}
                          . Payment is optional and activates only after
                          CampusGig verifies PayMongo payment.
                        </p>
                        {latestRevisionPurchase?.activationStatus ===
                        "RECONCILIATION_REQUIRED" ? (
                          <strong>
                            Payment was recorded but this stale checkout could
                            not activate. Contact support; no refund has been
                            fabricated.
                          </strong>
                        ) : (
                          <>
                            <textarea
                              value={extraRevisionInstructions}
                              onChange={(event) =>
                                setExtraRevisionInstructions(event.target.value)
                              }
                              maxLength={2000}
                              placeholder="Describe the in-scope extra change…"
                            />
                            <button
                              disabled={
                                openingExtraRevisionCheckout ||
                                extraRevisionInstructions.trim().length < 10
                              }
                              onClick={() => void openExtraRevisionCheckout()}
                            >
                              {openingExtraRevisionCheckout
                                ? "Opening checkout…"
                                : latestRevisionPurchase?.paymentStatus ===
                                    "REQUIRES_ACTION"
                                  ? "Continue Extra Revision Checkout"
                                  : "Purchase Extra Revision"}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  <div className="correction-claim-card">
                    <b>Work does not match the original requirements?</b>
                    <p>
                      Ask the provider to acknowledge a free correction. This
                      does not bypass revision limits automatically. If the
                      provider disagrees, use Report a Problem separately.
                    </p>
                    {pendingCorrectionClaim ? (
                      <strong>Waiting for provider acknowledgement.</strong>
                    ) : (
                      <>
                        <textarea
                          value={correctionInstructions}
                          onChange={(event) =>
                            setCorrectionInstructions(event.target.value)
                          }
                          maxLength={2000}
                          placeholder="Identify the unmet original requirement…"
                        />
                        <button
                          disabled={
                            acting || correctionInstructions.trim().length < 10
                          }
                          onClick={() => void requestCorrectionClaim()}
                        >
                          Ask Provider to Acknowledge Correction
                        </button>
                      </>
                    )}
                  </div>
                  <div className="scope-change-guidance">
                    <b>Need something outside the original requirements?</b>
                    <p>
                      This request changes the original scope of the order.
                      Create a new order for additional work.
                    </p>
                  </div>
                </section>
              )}
            {perspective === "client" &&
              active.status === "COMPLETED" &&
              paymentConfirmed &&
              !active.review && (
                <section className="client-order-actions">
                  <span className="kicker">RATE YOUR PROVIDER</span>
                  <h3>How was your experience?</h3>
                  <div className="web-rating" aria-label="Rating">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        className={value <= rating ? "active" : ""}
                        aria-label={`${value} star${value === 1 ? "" : "s"}`}
                        onClick={() => setRating(value)}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value)}
                    maxLength={1000}
                    placeholder="Share your experience (optional)…"
                  />
                  <button
                    className="accept-order-button"
                    disabled={acting}
                    onClick={() => void clientAction("review")}
                  >
                    {acting ? "Submitting…" : `Submit ${rating}-star review`}
                  </button>
                </section>
              )}
            {perspective === "client" && active.review && (
              <section className="submitted-review">
                <strong>{"★".repeat(active.review.overallRating)}</strong>
                <h3>Review submitted</h3>
                {active.review.comment && <p>{active.review.comment}</p>}
              </section>
            )}
            {perspective === "client" &&
              (paymentCanRecover || refundInProgress || paymentStatus === "REFUNDED") && (
              <section className="workspace-payment">
                <span className="kicker">SECURE PAYMENT</span>
                <div className="payment-summary-card">
                  <div>
                    <h3>
                      {paymentStatus === "REFUNDED"
                        ? "Full refund completed"
                        : refundInProgress
                          ? "Full refund in progress"
                        : paymentConfirmed
                          ? "Payment confirmed"
                        : "Pay securely with PayMongo"}
                    </h3>
                    <p>
                      {paymentStatus === "REFUNDED"
                        ? "PayMongo confirmed the full refund, including the CampusGig service fee."
                        : refundInProgress
                          ? "Work and delivery are blocked while CampusGig waits for authoritative PayMongo confirmation."
                        : paymentConfirmed
                          ? "Your payment has been verified by PayMongo."
                        : "Complete checkout using an available test payment method. CampusGig verifies the result automatically."}
                    </p>
                  </div>
                  <b>
                    ₱
                    {(active.totalCentavos / 100).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                  </b>
                  <div className="payment-breakdown">
                    {v2Order && (active.rushSurchargeCentavos ?? 0) > 0 && (
                      <small>
                        Base service ₱
                        {((active.basePriceCentavos ?? 0) / 100).toLocaleString(
                          undefined,
                          { minimumFractionDigits: 2 },
                        )}
                      </small>
                    )}
                    <small>
                      {v2Order && (active.rushSurchargeCentavos ?? 0) > 0
                        ? "Rush surcharge ₱"
                        : "Service ₱"}
                      {(
                        (v2Order && (active.rushSurchargeCentavos ?? 0) > 0
                          ? active.rushSurchargeCentavos!
                          : active.subtotalCentavos) / 100
                      ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </small>
                    <small>
                      CampusGig service fee ₱
                      {(active.platformFeeCentavos / 100).toLocaleString(
                        undefined,
                        { minimumFractionDigits: 2 },
                      )}
                    </small>
                  </div>
                  {!paymentConfirmed &&
                    !refundInProgress &&
                    paymentStatus !== "REFUNDED" &&
                    !paymentVerificationPending && (
                    <button
                      className="payment-checkout-button"
                      disabled={openingCheckout}
                      onClick={() => void openCheckout()}
                    >
                      <Icon name="card" />
                      <span>
                        {openingCheckout
                          ? "Opening secure checkout…"
                          : paymentStatus === "REQUIRES_ACTION"
                            ? "Continue checkout"
                            : "Proceed to payment"}
                      </span>
                      {!openingCheckout && <Icon name="arrow" />}
                    </button>
                  )}
                  {!paymentConfirmed && paymentVerificationPending && (
                    <div className="payment-verification-actions">
                      <span aria-live="polite">
                        Verifying payment confirmation…
                      </span>
                      <button
                        className="payment-check-status-button"
                        disabled={checkingPayment}
                        onClick={() => void checkPaymentStatus()}
                      >
                        {checkingPayment
                          ? "Checking payment…"
                          : "Check payment status"}
                      </button>
                    </div>
                  )}
                  {paymentStatus && (
                    <span
                      className={`payment-status ${paymentStatus.toLowerCase()}`}
                    >
                      {formatMarketplaceStatus(paymentStatus)}
                    </span>
                  )}
                  {paymentConfirmed && refundEligibility?.canRequest && (
                    <div className="payment-verification-actions">
                      {refundEligibility.eligibleReasons.map((reason) => (
                        <button
                          key={reason}
                          className="payment-check-status-button"
                          disabled={requestingRefund}
                          onClick={() => void requestFullRefund(reason)}
                        >
                          {requestingRefund
                            ? "Requesting full refund…"
                            : reason === "MISSED_RUSH_DEADLINE"
                              ? "Request full rush refund"
                              : "Cancel and request full refund"}
                        </button>
                      ))}
                    </div>
                  )}
                  {refund && (
                    <small aria-live="polite">
                      Refund {formatMarketplaceStatus(refund.status)}
                    </small>
                  )}
                </div>
              </section>
            )}
            {[
              "ACCEPTED",
              "IN_PROGRESS",
              "SUBMITTED",
              "REVISION_REQUESTED",
              "COMPLETED",
            ].includes(active.status) && (
              <section className="workspace-dispute">
                <span className="kicker">SUPPORT & SAFETY</span>
                {dispute && !showDisputeForm ? (
                  <div className="dispute-status-card">
                    <div>
                      <h3>
                        Report{" "}
                        {formatMarketplaceStatus(dispute.status).toLowerCase()}
                      </h3>
                      <p>
                        {dispute.reason.replaceAll("_", " ").toLowerCase()} ·
                        Submitted{" "}
                        {new Date(dispute.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span>{formatMarketplaceStatus(dispute.status)}</span>
                    <p>{dispute.details}</p>
                    {disputeActive && (
                      <p>
                        <b>Completion paused.</b> Affected earnings are frozen
                        where applicable. No refund has been issued.
                      </p>
                    )}
                    {dispute.responseDeadlineAt &&
                      (dispute.status === "WAITING_FOR_CLIENT" ||
                        dispute.status === "WAITING_FOR_PROVIDER") && (
                        <p>
                          <b>
                            Waiting for{" "}
                            {dispute.responseRequestedFrom?.toLowerCase()}:
                          </b>{" "}
                          respond by{" "}
                          {new Date(
                            dispute.responseDeadlineAt,
                          ).toLocaleString()}
                          .
                        </p>
                      )}
                    {dispute.targetDeliverySubmission && (
                      <p>
                        Delivery version{" "}
                        {dispute.targetDeliverySubmission.version}
                        {dispute.targetRevisionRequest
                          ? ` · revision ${dispute.targetRevisionRequest.sequenceNumber}`
                          : ""}
                      </p>
                    )}
                    {dispute.affectedEarnings.map((affected) => (
                      <p key={affected.id}>
                        <b>Affected earning:</b>{" "}
                        {affected.providerEarning.sourceType.replaceAll(
                          "_",
                          " ",
                        )}{" "}
                        · {affected.preFreezeStatus} →{" "}
                        {affected.providerEarning.status}
                      </p>
                    ))}
                    {dispute.evidence.length > 0 && (
                      <div>
                        <b>Evidence</b>
                        {dispute.evidence.map((item) => (
                          <button
                            type="button"
                            className="link-button"
                            key={item.id}
                            onClick={() =>
                              void downloadDisputeEvidence(
                                item.id,
                                item.originalName,
                              )
                            }
                          >
                            {item.originalName} ·{" "}
                            {Math.ceil(item.sizeBytes / 1024)} KB
                          </button>
                        ))}
                        <small>
                          Downloading a file does not automatically accept the
                          order.
                        </small>
                      </div>
                    )}
                    {dispute.responses.map((response) => (
                      <div key={response.id}>
                        <b>{response.responder.displayName} responded</b>
                        <p>{response.details}</p>
                      </div>
                    ))}
                    {canRespondToDispute && (
                      <form
                        className="dispute-form"
                        onSubmit={submitDisputeResponse}
                      >
                        <label>
                          Your response
                          <textarea
                            value={responseDetails}
                            onChange={(event) =>
                              setResponseDetails(event.target.value)
                            }
                            minLength={10}
                            maxLength={4000}
                            required
                          />
                        </label>
                        <label>
                          Optional evidence (JPG, PNG, WebP, or PDF; 10 MB each)
                          <input
                            type="file"
                            multiple
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            onChange={(event) =>
                              setResponseFiles(
                                Array.from(event.target.files ?? []),
                              )
                            }
                          />
                        </label>
                        <button
                          disabled={
                            submittingResponse ||
                            responseDetails.trim().length < 10
                          }
                        >
                          {submittingResponse
                            ? "Submitting…"
                            : "Submit response"}
                        </button>
                      </form>
                    )}
                    {disputeActive && !canRespondToDispute && (
                      <div className="dispute-form">
                        <label>
                          Add evidence without replacing earlier files
                          <input
                            type="file"
                            multiple
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            onChange={(event) =>
                              setAdditionalEvidence(
                                Array.from(event.target.files ?? []),
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          disabled={
                            submittingResponse || !additionalEvidence.length
                          }
                          onClick={() => void addDisputeEvidence()}
                        >
                          Add evidence
                        </button>
                      </div>
                    )}
                    {dispute.timeline.length > 0 && (
                      <div>
                        <b>Dispute timeline</b>
                        {dispute.timeline.map((event) => (
                          <p key={event.id}>
                            {event.type.replaceAll("_", " ")} ·{" "}
                            {new Date(event.createdAt).toLocaleString()}
                            {event.details ? ` — ${event.details}` : ""}
                          </p>
                        ))}
                      </div>
                    )}
                    {dispute.resolutionNote && (
                      <p>
                        <b>Resolution:</b> {dispute.resolutionNote}
                      </p>
                    )}
                    {!disputeActive && (
                      <button
                        type="button"
                        className="report-problem-button"
                        onClick={() => setShowDisputeForm(true)}
                      >
                        Open a new eligible dispute
                      </button>
                    )}
                  </div>
                ) : showDisputeForm ? (
                  <form className="dispute-form" onSubmit={submitDispute}>
                    <h3>Report an order problem</h3>
                    <p>
                      CampusGig administrators will review this report. Messages
                      and order activity remain available as evidence.
                    </p>
                    <label>
                      Reason
                      <select
                        value={disputeReason}
                        onChange={(event) =>
                          setDisputeReason(event.target.value as DisputeReason)
                        }
                      >
                        <option value="SERVICE_NOT_DELIVERED">
                          Service not delivered
                        </option>
                        <option value="QUALITY_ISSUE">Quality issue</option>
                        <option value="REQUIREMENTS_MISMATCH">
                          Requirements mismatch
                        </option>
                        <option value="PAYMENT_ISSUE">Payment issue</option>
                        <option value="CONDUCT">
                          Conduct or safety concern
                        </option>
                        <option value="OTHER">Other</option>
                      </select>
                    </label>
                    <label>
                      What happened?
                      <textarea
                        value={disputeDetails}
                        onChange={(event) =>
                          setDisputeDetails(event.target.value)
                        }
                        minLength={10}
                        maxLength={2000}
                        placeholder="Provide specific details for the review team…"
                        required
                      />
                    </label>
                    <label>
                      Optional evidence (JPG, PNG, WebP, or PDF; 10 MB each)
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={(event) =>
                          setDisputeFiles(Array.from(event.target.files ?? []))
                        }
                      />
                    </label>
                    <div className="dispute-form-actions">
                      <button
                        type="button"
                        className="reject"
                        onClick={() => setShowDisputeForm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        disabled={
                          submittingDispute || disputeDetails.trim().length < 10
                        }
                      >
                        {submittingDispute ? "Submitting…" : "Submit report"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="dispute-entry">
                    <div>
                      <h3>Need help with this order?</h3>
                      <p>
                        Report delivery, quality, payment, or conduct problems
                        for administrator review.
                      </p>
                    </div>
                    <button
                      className="report-problem-button"
                      onClick={() => setShowDisputeForm(true)}
                    >
                      <Icon name="flag" />
                      <span>Report a problem</span>
                    </button>
                  </div>
                )}
              </section>
            )}
            <section className="workspace-timeline">
              <h3>Order timeline</h3>
              <div className="web-timeline">
                {detail ? (
                  detail.history.map((item) => (
                    <div key={item.id}>
                      <i />
                      <span>
                        <b>{formatMarketplaceStatus(item.toStatus)}</b>
                        <small>
                          {item.note} · {item.actor?.displayName ?? "CampusGig"}
                        </small>
                        <time>{new Date(item.createdAt).toLocaleString()}</time>
                      </span>
                    </div>
                  ))
                ) : (
                  <SkeletonCollection
                    kind="listing"
                    count={2}
                    label="Loading order timeline"
                  />
                )}
              </div>
            </section>
          </aside>
          <main>
            <div className="workspace-chat-head">
              <div>
                <h3>Order messages</h3>
                <small>
                  <i /> Private conversation with {counterparty.displayName}
                </small>
                <small aria-live="polite">
                  {!realtimeSocketEnabled()
                    ? "Refreshing automatically"
                    : realtimeConnected
                      ? "Live updates connected"
                      : "Reconnecting live updates…"}
                </small>
              </div>
              <button onClick={() => void refresh()}>Refresh</button>
            </div>
            <div className="web-messages">
              {!detail ? (
                <SkeletonCollection
                  kind="conversation"
                  count={4}
                  label="Loading order messages"
                />
              ) : messages.length ? (
                messages.map((message, index) => {
                  const previousMessage = messages[index - 1];
                  const startsNewDay =
                    !previousMessage ||
                    campusDateKey(new Date(previousMessage.createdAt)) !==
                      campusDateKey(new Date(message.createdAt));

                  return (
                    <Fragment key={message.id}>
                      <div className="web-message-date">
                        <time>
                          {startsNewDay
                            ? messageDateLabel(message.createdAt)
                            : messageTimeLabel(message.createdAt)}
                        </time>
                      </div>
                      <div className={message.isMine ? "mine" : ""}>
                        <i className="chat-avatar">
                          {message.isMine
                            ? "Y"
                            : message.sender.displayName
                                .charAt(0)
                                .toUpperCase()}
                        </i>
                        <span>
                          <b>
                            {message.isMine
                              ? "You"
                              : message.sender.displayName}
                          </b>
                          {message.body && <em>{message.body}</em>}
                          {message.attachments?.map((file) => (
                            <button
                              type="button"
                              className="chat-attachment"
                              key={file.id}
                              onClick={() =>
                                void downloadFile(file.id, file.originalName)
                              }
                            >
                              <strong>⇩ {file.originalName}</strong>
                              <small>
                                {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB
                              </small>
                            </button>
                          ))}
                          {message.isMine && index === messages.length - 1 && (
                            <small>{peerRead ? "Read" : "Sent"}</small>
                          )}
                        </span>
                      </div>
                    </Fragment>
                  );
                })
              ) : (
                <div className="workspace-chat-empty">
                  No messages yet. Start the conversation about this order.
                </div>
              )}
            </div>
            <form className="web-composer" onSubmit={send}>
              <label className="message-attach" title="Attach files">
                ＋
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.pdf,.zip,.docx,.xlsx"
                  onChange={(event) =>
                    setMessageFiles(
                      Array.from(event.target.files ?? []).slice(0, 3),
                    )
                  }
                />
                {messageFiles.length > 0 && <i>{messageFiles.length}</i>}
              </label>
              {messageFiles.length > 0 && (
                <div className="message-file-preview">
                  <span>
                    {messageFiles.map((file) => file.name).join(" · ")}
                  </span>
                  <button type="button" onClick={() => setMessageFiles([])}>
                    Clear
                  </button>
                </div>
              )}
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={2000}
                placeholder={
                  messageFiles.length
                    ? `${messageFiles.length} file(s) selected · Add a note…`
                    : "Write a message about this order…"
                }
              />
              <button
                disabled={(!draft.trim() && !messageFiles.length) || sending}
              >
                {sending ? "Sending…" : "Send →"}
              </button>
            </form>
          </main>
          {appDialog.dialog}
        </div>
      </div>
    </div>,
    document.body,
  );
}
