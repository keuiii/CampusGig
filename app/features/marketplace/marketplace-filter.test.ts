import assert from "node:assert/strict";
import test from "node:test";
import type { Service } from "../../types";
import {
  filterAndSortServices,
  matchesBudgetRange,
  type MarketplaceFilters,
} from "./marketplace-filter";

const service = (
  id: string,
  price: number,
  rating: number,
  deliveryDays: number,
  publishedAt: string,
): Service => ({
  id,
  title: `${id} service`,
  description: "Campus service",
  providerId: `${id}-provider`,
  provider: `${id} provider`,
  providerHasAvatar: false,
  providerAvatarVersion: 1,
  acceptingOrders: true,
  initials: id,
  program: "BSIT",
  school: "Batangas State University",
  schoolId: "bsu",
  category: "Programming",
  price,
  rating,
  reviews: 1,
  delivery: `${deliveryDays} days`,
  publishedAt,
  packages: [
    {
      id: `${id}-package`,
      tier: "BASIC",
      name: "Basic",
      description: "Package",
      priceCentavos: price * 100,
      deliveryDays,
      revisionLimit: 1,
    },
  ],
});

const defaults: MarketplaceFilters = {
  query: "",
  category: "All",
  schoolId: "",
  budgetRange: "any",
  minimumRating: 0,
  maximumDeliveryDays: null,
  sort: "recommended",
};

test("marketplace filters combine price, rating, delivery, school, and category", () => {
  const services = [
    service("match", 500, 4.8, 2, "2026-09-25T00:00:00.000Z"),
    service("expensive", 900, 5, 1, "2026-09-24T00:00:00.000Z"),
    service("slow", 400, 4.9, 7, "2026-09-23T00:00:00.000Z"),
  ];

  assert.deepEqual(
    filterAndSortServices(services, {
      ...defaults,
      query: "match",
      category: "Programming",
      schoolId: "bsu",
      budgetRange: "500-999",
      minimumRating: 4.5,
      maximumDeliveryDays: 3,
    }).map(({ id }) => id),
    ["match"],
  );
});

test("budget ranges assign every boundary to exactly one choice", () => {
  assert.equal(matchesBudgetRange(499, "under-500"), true);
  assert.equal(matchesBudgetRange(500, "under-500"), false);
  assert.equal(matchesBudgetRange(500, "500-999"), true);
  assert.equal(matchesBudgetRange(999, "500-999"), true);
  assert.equal(matchesBudgetRange(1_000, "500-999"), false);
  assert.equal(matchesBudgetRange(1_000, "1000-2499"), true);
  assert.equal(matchesBudgetRange(2_499, "1000-2499"), true);
  assert.equal(matchesBudgetRange(2_500, "2500-4999"), true);
  assert.equal(matchesBudgetRange(4_999, "2500-4999"), true);
  assert.equal(matchesBudgetRange(5_000, "5000-plus"), true);
});

test("marketplace sorting is stable for rating, price, delivery, and newest", () => {
  const services = [
    service("middle", 500, 4.5, 3, "2026-09-24T00:00:00.000Z"),
    service("best", 700, 5, 5, "2026-09-23T00:00:00.000Z"),
    service("new", 300, 4, 1, "2026-09-25T00:00:00.000Z"),
  ];

  const ids = (sort: MarketplaceFilters["sort"]) =>
    filterAndSortServices(services, { ...defaults, sort }).map(({ id }) => id);
  assert.deepEqual(ids("rating"), ["best", "middle", "new"]);
  assert.deepEqual(ids("price-low"), ["new", "middle", "best"]);
  assert.deepEqual(ids("delivery-fast"), ["new", "middle", "best"]);
  assert.deepEqual(ids("newest"), ["new", "middle", "best"]);
});

test("single-price V2 delivery participates in filters without a fabricated package", () => {
  const v2: Service = {
    ...service("v2", 750, 4.7, 30, "2026-10-02T00:00:00.000Z"),
    pricingModel: "SINGLE_PRICE_V2",
    basePriceCentavos: 75_000,
    normalDeliveryMinutes: 2880,
    includedRevisionLimit: 2,
    packages: [],
  };
  assert.deepEqual(
    filterAndSortServices([v2], {
      ...defaults,
      maximumDeliveryDays: 2,
    }).map(({ id }) => id),
    ["v2"],
  );
  assert.equal(
    filterAndSortServices([v2], {
      ...defaults,
      maximumDeliveryDays: 1,
    }).length,
    0,
  );
});
