import { DisputeStatus } from "@prisma/client";

export const ACTIVE_DISPUTE_STATUSES = [
  DisputeStatus.OPEN,
  DisputeStatus.WAITING_FOR_CLIENT,
  DisputeStatus.WAITING_FOR_PROVIDER,
  DisputeStatus.READY_FOR_REVIEW,
  DisputeStatus.UNDER_REVIEW,
] as const;

export function isActiveDisputeStatus(status: DisputeStatus) {
  return (ACTIVE_DISPUTE_STATUSES as readonly DisputeStatus[]).includes(status);
}
