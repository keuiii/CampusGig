import type { Service } from "../../types";
import { isSinglePriceV2ServicePricingModel } from "../../lib/pricing-model";

export type MarketplaceSort =
  | "recommended"
  | "newest"
  | "rating"
  | "price-low"
  | "delivery-fast";

export type MarketplaceBudgetRange =
  | "any"
  | "under-500"
  | "500-999"
  | "1000-2499"
  | "2500-4999"
  | "5000-plus";

export const marketplaceBudgetLabels: Record<MarketplaceBudgetRange, string> = {
  any: "Any budget",
  "under-500": "Below ₱500",
  "500-999": "₱500–₱999",
  "1000-2499": "₱1,000–₱2,499",
  "2500-4999": "₱2,500–₱4,999",
  "5000-plus": "₱5,000 and above",
};

export type MarketplaceFilters = {
  query: string;
  category: string;
  schoolId: string;
  budgetRange: MarketplaceBudgetRange;
  minimumRating: number;
  maximumDeliveryDays: number | null;
  sort: MarketplaceSort;
};

function deliveryDays(service: Service) {
  if (isSinglePriceV2ServicePricingModel(service.pricingModel))
    return service.normalDeliveryMinutes == null
      ? Number.POSITIVE_INFINITY
      : service.normalDeliveryMinutes / 1440;
  return service.packages.length > 0
    ? Math.min(...service.packages.map((item) => item.deliveryDays))
    : Number.POSITIVE_INFINITY;
}

export function matchesBudgetRange(
  price: number,
  range: MarketplaceBudgetRange,
) {
  switch (range) {
    case "under-500":
      return price < 500;
    case "500-999":
      return price >= 500 && price < 1_000;
    case "1000-2499":
      return price >= 1_000 && price < 2_500;
    case "2500-4999":
      return price >= 2_500 && price < 5_000;
    case "5000-plus":
      return price >= 5_000;
    default:
      return true;
  }
}

export function filterAndSortServices(
  services: Service[],
  filters: MarketplaceFilters,
) {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();
  const matches = services.filter((service) => {
    const searchable =
      `${service.title} ${service.provider} ${service.category} ${service.school}`.toLocaleLowerCase();
    return (
      (!normalizedQuery || searchable.includes(normalizedQuery)) &&
      (filters.category === "All" || service.category === filters.category) &&
      (!filters.schoolId || service.schoolId === filters.schoolId) &&
      matchesBudgetRange(service.price, filters.budgetRange) &&
      service.rating >= filters.minimumRating &&
      (filters.maximumDeliveryDays === null ||
        deliveryDays(service) <= filters.maximumDeliveryDays)
    );
  });

  return matches
    .map((service, index) => ({ service, index }))
    .sort((left, right) => {
      let comparison = 0;
      switch (filters.sort) {
        case "newest":
          comparison =
            Date.parse(right.service.publishedAt) -
            Date.parse(left.service.publishedAt);
          break;
        case "rating":
          comparison = right.service.rating - left.service.rating;
          break;
        case "price-low":
          comparison = left.service.price - right.service.price;
          break;
        case "delivery-fast":
          comparison = deliveryDays(left.service) - deliveryDays(right.service);
          break;
        default:
          comparison = left.index - right.index;
      }
      return comparison || left.index - right.index;
    })
    .map(({ service }) => service);
}
