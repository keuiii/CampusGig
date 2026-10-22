const marketplaceStatusLabels: Readonly<Record<string, string>> = {
  REQUIRES_ACTION: "Awaiting payment",
  RECONCILIATION_REQUIRED: "Needs review",
  PENDING_REVIEW: "Pending review",
  REVISION_REQUESTED: "Revision requested",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUND_PENDING: "Refund processing",
  RESOLVED_CLIENT: "Resolved for client",
  RESOLVED_PROVIDER: "Resolved for provider",
  RESOLVED_SPLIT: "Resolved with split outcome",
};

export function formatMarketplaceStatus(status: string | null | undefined) {
  const normalized = status?.trim().toUpperCase();
  if (!normalized) return "Not available";
  if (marketplaceStatusLabels[normalized])
    return marketplaceStatusLabels[normalized];

  return normalized
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
