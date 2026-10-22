import type { OrderPricingModel, ServicePricingModel } from "../types";

export const legacyServicePricingModel = "LEGACY_PACKAGES" as const;
export const singlePriceV2ServicePricingModel = "SINGLE_PRICE_V2" as const;
export const legacyOrderPricingModel = "LEGACY_PACKAGE_V1" as const;
export const singlePriceV2OrderPricingModel = "SINGLE_PRICE_V2" as const;

export function isLegacyServicePricingModel(
  value: ServicePricingModel | null | undefined,
) {
  return (
    value === undefined || value === null || value === legacyServicePricingModel
  );
}

export function isSinglePriceV2ServicePricingModel(
  value: ServicePricingModel | null | undefined,
) {
  return value === singlePriceV2ServicePricingModel;
}

export function formatDeliveryMinutes(minutes: number | null | undefined) {
  if (!Number.isInteger(minutes) || !minutes || minutes < 1)
    return "Unavailable";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
}

export function isLegacyOrderPricingModel(
  value: OrderPricingModel | null | undefined,
) {
  return (
    value === undefined || value === null || value === legacyOrderPricingModel
  );
}

export function isSinglePriceV2OrderPricingModel(
  value: OrderPricingModel | null | undefined,
) {
  return value === singlePriceV2OrderPricingModel;
}
