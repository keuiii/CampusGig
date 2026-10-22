export type EarningOrderSnapshot = {
  pricingModel: "LEGACY_PACKAGE_V1" | "SINGLE_PRICE_V2";
  subtotalCentavos: number;
  platformFeeCentavos: number;
  totalCentavos: number;
  currency: string;
};

export type EarningPaymentSnapshot = {
  id: string;
  amountCentavos: number;
  platformFeeCentavos: number;
  providerNetCentavos: number;
  currency: string;
};

export function providerEarningPrincipal(
  order: EarningOrderSnapshot,
  payment: EarningPaymentSnapshot,
) {
  const currency = payment.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency !== order.currency)
    throw new Error("Payment and order currencies do not match");
  if (
    payment.amountCentavos !== order.totalCentavos ||
    payment.platformFeeCentavos !== order.platformFeeCentavos
  )
    throw new Error("Payment and order financial snapshots do not match");

  const amountCentavos =
    order.pricingModel === "SINGLE_PRICE_V2"
      ? order.subtotalCentavos
      : payment.providerNetCentavos;
  if (!Number.isSafeInteger(amountCentavos) || amountCentavos <= 0)
    throw new Error("Provider earning principal is invalid");
  if (
    order.pricingModel === "SINGLE_PRICE_V2" &&
    payment.providerNetCentavos !== order.subtotalCentavos
  )
    throw new Error("V2 provider earning snapshots do not match");

  return { amountCentavos, currency };
}

export function pendingEarningCreditSourceKey(paymentId: string) {
  return `payment:${paymentId}:earning-pending-credit`;
}

export function revisionPendingEarningCreditSourceKey(purchaseId: string) {
  return `revision-purchase:${purchaseId}:earning-pending-credit`;
}
