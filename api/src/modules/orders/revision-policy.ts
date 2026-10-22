export const extraRevisionPricingPolicyVersion = 1;
export const extraRevisionBasisPoints = 1_000;
export const extraRevisionMinimumCentavos = 2_000;
export const extraRevisionPlatformFeeBasisPoints = 500;
export const revisionTurnaroundPercent = 50;
export const revisionTurnaroundMinimumMinutes = 180;
export const revisionTurnaroundMaximumMinutes = 4_320;

function ceilRatio(value: number, numerator: number, denominator: number) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("Revision pricing basis must be a positive integer");
  const result =
    (BigInt(value) * BigInt(numerator) + BigInt(denominator - 1)) /
    BigInt(denominator);
  const amount = Number(result);
  if (!Number.isSafeInteger(amount))
    throw new Error("Revision calculation exceeds the supported range");
  return amount;
}

export function revisionTurnaroundMinutes(originalDurationMinutes: number) {
  const calculated = ceilRatio(
    originalDurationMinutes,
    revisionTurnaroundPercent,
    100,
  );
  return Math.min(
    revisionTurnaroundMaximumMinutes,
    Math.max(revisionTurnaroundMinimumMinutes, calculated),
  );
}

export function revisionDeadlineAt(startedAt: Date, turnaroundMinutes: number) {
  if (
    Number.isNaN(startedAt.getTime()) ||
    !Number.isSafeInteger(turnaroundMinutes) ||
    turnaroundMinutes < revisionTurnaroundMinimumMinutes ||
    turnaroundMinutes > revisionTurnaroundMaximumMinutes
  )
    throw new Error("Revision deadline inputs are invalid");
  return new Date(startedAt.getTime() + turnaroundMinutes * 60_000);
}

export function paidExtraRevisionQuote(
  pricingBasisCentavos: number,
  currencyValue: string,
  originalDurationMinutes: number,
) {
  const currency = currencyValue.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error("Revision currency is invalid");
  const percentage = ceilRatio(
    pricingBasisCentavos,
    extraRevisionBasisPoints,
    10_000,
  );
  const providerSubtotalCentavos = Math.max(
    extraRevisionMinimumCentavos,
    percentage,
  );
  const platformFeeCentavos = ceilRatio(
    providerSubtotalCentavos,
    extraRevisionPlatformFeeBasisPoints,
    10_000,
  );
  const totalCentavos = providerSubtotalCentavos + platformFeeCentavos;
  if (!Number.isSafeInteger(totalCentavos))
    throw new Error("Revision total exceeds the supported range");
  return {
    revisionType: "PAID_EXTRA" as const,
    providerSubtotalCentavos,
    platformFeeCentavos,
    clientTotalCentavos: totalCentavos,
    currency,
    turnaroundMinutes: revisionTurnaroundMinutes(originalDurationMinutes),
    pricingPolicyVersion: extraRevisionPricingPolicyVersion,
    pricingBasisCentavos,
    deliveryDurationBasisMinutes: originalDurationMinutes,
  };
}
