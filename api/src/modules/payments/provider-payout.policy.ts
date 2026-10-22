export const withdrawalHoldMilliseconds = 24 * 60 * 60 * 1000;

export type WithdrawableEarning = {
  status: string;
  availableAt: Date | null;
  grossServiceAmountCentavos: number;
  currency: string;
  hasActiveDispute: boolean;
  hasActiveRefund: boolean;
  hasActivePayoutReservation: boolean;
  ledgerEntries: { type: string; amountCentavos: number; currency: string }[];
};

export function withdrawalEligibleAt(availableAt: Date | null) {
  return availableAt
    ? new Date(availableAt.getTime() + withdrawalHoldMilliseconds)
    : null;
}

export function assertEarningFinancialInvariant(earning: WithdrawableEarning) {
  const credits = earning.ledgerEntries.filter(
    (entry) => entry.type === "EARNING_PENDING_CREDIT",
  );
  const reversals = earning.ledgerEntries.filter(
    (entry) => entry.type === "EARNING_REFUND_REVERSAL",
  );
  const economicPrincipal = [...credits, ...reversals].reduce(
    (total, entry) => total + entry.amountCentavos,
    0,
  );
  if (
    credits.length !== 1 ||
    credits[0].amountCentavos !== earning.grossServiceAmountCentavos ||
    credits[0].currency !== earning.currency ||
    reversals.length !== 0 ||
    economicPrincipal !== earning.grossServiceAmountCentavos ||
    !Number.isSafeInteger(economicPrincipal) ||
    economicPrincipal <= 0
  )
    throw new Error("Provider earning principal does not reconcile");
  return economicPrincipal;
}

export function isEarningWithdrawable(
  earning: WithdrawableEarning,
  now: Date,
  currency = earning.currency,
) {
  const eligibleAt = withdrawalEligibleAt(earning.availableAt);
  if (
    earning.status !== "AVAILABLE" ||
    !eligibleAt ||
    now.getTime() < eligibleAt.getTime() ||
    earning.currency !== currency ||
    earning.hasActiveDispute ||
    earning.hasActiveRefund ||
    earning.hasActivePayoutReservation
  )
    return false;
  assertEarningFinancialInvariant(earning);
  return true;
}
