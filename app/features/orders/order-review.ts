import type { MarketplaceOrder } from "../../types";

const minuteMilliseconds = 60_000;

export function reviewTimeRemaining(
  deadline: string | null | undefined,
  now = Date.now(),
) {
  if (!deadline) return null;
  const deadlineMilliseconds = Date.parse(deadline);
  if (!Number.isFinite(deadlineMilliseconds)) return null;
  const remaining = Math.max(0, deadlineMilliseconds - now);
  if (remaining === 0) return "Review period ended";

  const totalMinutes = Math.ceil(remaining / minuteMilliseconds);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m remaining`;
  if (minutes === 0) return `${hours}h remaining`;
  return `${hours}h ${minutes}m remaining`;
}

export function reviewDeadlineLabel(deadline: string | null | undefined) {
  if (!deadline) return null;
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function completionExplanation(order: MarketplaceOrder) {
  if (order.completionSource === "AUTO_REVIEW_TIMEOUT") {
    return "The 48-hour delivery review period ended, so CampusGig completed this order automatically and made the provider earning available.";
  }
  if (order.completionSource === "CLIENT_ACCEPTED") {
    return "The client accepted the delivery. The provider earning is now available.";
  }
  return null;
}

export function hasActiveReviewWindow(order: MarketplaceOrder) {
  return (
    order.reviewPolicyVersion === 1 &&
    order.status === "SUBMITTED" &&
    Boolean(order.reviewDeadlineAt)
  );
}
