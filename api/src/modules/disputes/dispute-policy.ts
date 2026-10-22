import {
  DisputeReason,
  DisputeResponseParty,
  DisputeStatus,
} from "@prisma/client";

export const disputeResponseWindowMs = 48 * 60 * 60 * 1000;

export function responseDeadline(requestedAt: Date) {
  return new Date(requestedAt.getTime() + disputeResponseWindowMs);
}

export function waitingStatus(requestedFrom: DisputeResponseParty) {
  return requestedFrom === DisputeResponseParty.CLIENT
    ? DisputeStatus.WAITING_FOR_CLIENT
    : DisputeStatus.WAITING_FOR_PROVIDER;
}

export function canOpenAfterExplicitAcceptance(reason: DisputeReason) {
  return (
    reason === DisputeReason.PAYMENT_ISSUE || reason === DisputeReason.CONDUCT
  );
}

export function remainingReviewSeconds(deadline: Date, pausedAt: Date) {
  return Math.max(
    0,
    Math.ceil((deadline.getTime() - pausedAt.getTime()) / 1000),
  );
}

export function resumedReviewDeadline(
  resolvedAt: Date,
  remainingSeconds: number,
) {
  return new Date(resolvedAt.getTime() + remainingSeconds * 1000);
}

export function affectedEarningForTarget<
  T extends { sourceType: string; revisionPurchaseId: string | null },
>(earnings: T[], targetRevisionPurchaseId: string | null) {
  return targetRevisionPurchaseId
    ? earnings.find(
        (earning) =>
          earning.sourceType === "PAID_EXTRA_REVISION" &&
          earning.revisionPurchaseId === targetRevisionPurchaseId,
      )
    : earnings.find((earning) => earning.sourceType === "ORIGINAL_ORDER");
}
