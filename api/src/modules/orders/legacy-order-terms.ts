import type { Prisma } from "@prisma/client";

export const legacyOrderPricingModel = "LEGACY_PACKAGE_V1" as const;
export const legacyOrderTermsSnapshotVersion = 1 as const;

type LegacyPackageTerms = {
  id: string;
  tier: string;
  name: string;
  description: string;
  priceCentavos: number;
  deliveryDays: number;
  revisionLimit: number;
};

type LegacyOrderTermsInput = {
  serviceTitle: string;
  package: LegacyPackageTerms;
  currency: string;
  subtotalCentavos: number;
  platformFeeCentavos: number;
  totalCentavos: number;
  revisionLimit: number;
  dueAt: Date;
};

export function buildLegacyOrderTermsSnapshot(
  input: LegacyOrderTermsInput,
): Prisma.InputJsonObject {
  return {
    version: legacyOrderTermsSnapshotVersion,
    pricingModel: legacyOrderPricingModel,
    service: { title: input.serviceTitle },
    package: { ...input.package },
    pricing: {
      currency: input.currency,
      subtotalCentavos: input.subtotalCentavos,
      platformFeeCentavos: input.platformFeeCentavos,
      totalCentavos: input.totalCentavos,
    },
    fulfillment: {
      deliveryDays: input.package.deliveryDays,
      revisionLimit: input.revisionLimit,
      dueAt: input.dueAt.toISOString(),
      deadlineBasis: "STORED_DUE_AT",
    },
  };
}

export function termsSnapshotVersion(snapshot: unknown) {
  if (!isRecord(snapshot)) return null;
  const version = snapshot.version;
  return Number.isInteger(version) && Number(version) > 0
    ? Number(version)
    : null;
}

export function legacyPackageTerms(snapshot: unknown) {
  if (!isRecord(snapshot)) return null;
  if (
    snapshot.pricingModel !== legacyOrderPricingModel ||
    snapshot.version !== legacyOrderTermsSnapshotVersion ||
    !isRecord(snapshot.package)
  )
    return null;
  const value = snapshot.package;
  if (
    typeof value.id !== "string" ||
    typeof value.tier !== "string" ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    !Number.isInteger(value.priceCentavos) ||
    !Number.isInteger(value.deliveryDays) ||
    !Number.isInteger(value.revisionLimit)
  )
    return null;
  return {
    id: value.id,
    tier: value.tier,
    name: value.name,
    description: value.description,
    priceCentavos: Number(value.priceCentavos),
    deliveryDays: Number(value.deliveryDays),
    revisionLimit: Number(value.revisionLimit),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
