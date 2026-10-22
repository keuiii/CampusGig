import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { ProviderService } from "../src/modules/provider/provider.service";

const root = resolve(import.meta.dirname, "../..");
const providerRecord = {
  id: "9c3f7862-17f2-4ce7-99b1-d94982169cf2",
  displayName: "Campus Designer",
  avatarPath: "private/avatar.jpg",
  createdAt: new Date("2025-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-14T00:00:00.000Z"),
  providerProfile: {
    headline: "Student brand designer",
    bio: "I help campus organizations build clear identities.",
    skills: ["Figma", "Brand identity"],
    isAvailable: true,
    instagramUrl: "https://instagram.com/campusdesigner",
    linkedinUrl: "https://linkedin.com/in/campusdesigner",
    xUrl: null,
    portfolioUrl: "https://portfolio.example/campusdesigner",
  },
  studentProfile: {
    program: "BSBA",
    verificationStatus: "APPROVED",
    ratingAverage: 4.75,
    reviewCount: 8,
    completedOrderCount: 11,
    school: {
      id: "7ac8b97e-9325-4a66-aab5-e269d13141a5",
      name: "University of Batangas",
      shortName: "UB",
      city: "Lipa City",
    },
  },
  services: [
    {
      id: "29c3c11e-3ccf-4ac7-a4cd-1acb45c4a8c5",
      title: "Logo design",
      description: "A complete visual identity.",
      category: { name: "Graphic Design" },
      packages: [
        {
          id: "f24e1953-e9ce-449d-ac71-e2a94eb5f8a2",
          tier: "BASIC",
          name: "Basic",
          description: "One concept",
          priceCentavos: 250000,
          deliveryDays: 3,
          revisionLimit: 2,
        },
      ],
      media: [],
    },
  ],
};

test("public provider response contains marketplace fields without private account data", async () => {
  let query: unknown;
  let reviewAggregateQuery: unknown;
  let completedOrderQuery: unknown;
  const prisma = {
    user: {
      findFirst: async (input: unknown) => {
        query = input;
        return providerRecord;
      },
    },
    review: {
      aggregate: async (input: unknown) => {
        reviewAggregateQuery = input;
        return {
          _avg: { overallRating: 4.75 },
          _count: { _all: 8 },
        };
      },
    },
    order: {
      count: async (input: unknown) => {
        completedOrderQuery = input;
        return 11;
      },
    },
  };
  const service = new ProviderService(prisma as never, {} as never);
  const response = await service.getPublicProfile(providerRecord.id);
  const serialized = JSON.stringify(response);

  assert.equal(response.data.displayName, "Campus Designer");
  assert.equal(response.data.services[0]?.price, 2500);
  assert.equal(response.data.verified, true);
  assert.equal(
    response.data.socialLinks.instagram,
    "https://instagram.com/campusdesigner",
  );
  assert.doesNotMatch(
    serialized,
    /email|password|secret|studentNumber|document|avatarPath/i,
  );
  assert.match(JSON.stringify(query), /"select"/);
  assert.match(JSON.stringify(reviewAggregateQuery), /"status":"COMPLETED"/);
  assert.match(JSON.stringify(completedOrderQuery), /"status":"COMPLETED"/);
});

test("missing or ineligible providers are returned as not found", async () => {
  const prisma = {
    user: { findFirst: async () => null },
    review: {
      aggregate: async () => ({
        _avg: { overallRating: null },
        _count: { _all: 0 },
      }),
    },
    order: { count: async () => 0 },
  };
  const service = new ProviderService(prisma as never, {} as never);
  await assert.rejects(
    () => service.getPublicProfile(providerRecord.id),
    NotFoundException,
  );
});

test("public reviews are completed-order-only, paginated, and anonymized", async () => {
  let findManyQuery: unknown;
  const prisma = {
    user: {
      findFirst: async () => ({
        id: providerRecord.id,
        studentProfile: { ratingAverage: 4.5, reviewCount: 7 },
      }),
    },
    review: {
      count: async () => 7,
      findMany: async (input: unknown) => {
        findManyQuery = input;
        return [
          {
            id: "review-1",
            overallRating: 5,
            qualityRating: 5,
            communicationRating: 4,
            timelinessRating: 5,
            comment: "Excellent work.",
            createdAt: new Date("2026-09-14T00:00:00.000Z"),
            reviewer: { displayName: "Kevin Jan Buenvenida" },
            order: { titleSnapshot: "Logo Design" },
          },
        ];
      },
      groupBy: async () => [
        { overallRating: 5, _count: { _all: 6 } },
        { overallRating: 2, _count: { _all: 1 } },
      ],
    },
  };
  const service = new ProviderService(prisma as never, {} as never);

  const response = await service.getPublicReviews(providerRecord.id, 99, 5);
  const serialized = JSON.stringify(response);

  assert.equal(response.pagination.page, 2);
  assert.equal(response.pagination.totalPages, 2);
  assert.equal(response.summary.total, 7);
  assert.equal(response.summary.average, 4.57);
  assert.deepEqual(response.summary.distribution, [
    { rating: 5, count: 6 },
    { rating: 4, count: 0 },
    { rating: 3, count: 0 },
    { rating: 2, count: 1 },
    { rating: 1, count: 0 },
  ]);
  assert.equal(response.data[0]?.reviewerLabel, "Kevin B.");
  assert.equal(response.data[0]?.serviceTitle, "Logo Design");
  assert.match(JSON.stringify(findManyQuery), /"status":"COMPLETED"/);
  assert.doesNotMatch(
    serialized,
    /reviewerId|revieweeId|orderId|email|displayName/i,
  );
});

test("provider dashboard calculates authoritative ratings and checklist readiness", async () => {
  const orderCounts = [5, 1, 2];
  let aggregateQuery: unknown;
  const serviceCountQueries: unknown[] = [];
  const prisma = {
    providerProfile: {
      findUnique: async () => ({
        headline: "Student designer",
        bio: "I create polished visual identities.",
        skills: ["Design", "Figma", "Branding"],
      }),
    },
    order: { count: async () => orderCounts.shift() ?? 0 },
    studentProfile: {
      findUnique: async () => ({ verificationStatus: "APPROVED" }),
    },
    review: {
      aggregate: async (input: unknown) => {
        aggregateQuery = input;
        return {
          _avg: { overallRating: 4.25 },
          _count: { _all: 4 },
        };
      },
    },
    service: {
      count: async (input: unknown) => {
        serviceCountQueries.push(input);
        return 1;
      },
    },
  };

  const response = await new ProviderService(
    prisma as never,
    {} as never,
  ).dashboard(providerRecord.id);

  assert.equal(response.activeOrders, 5);
  assert.equal(response.pendingRequests, 1);
  assert.equal(response.completedOrders, 2);
  assert.equal(response.averageRating, 4.25);
  assert.equal(response.reviewCount, 4);
  assert.equal(response.profileStrength, 100);
  assert.match(JSON.stringify(aggregateQuery), /"status":"COMPLETED"/);
  assert.equal(serviceCountQueries.length, 2);
  assert.match(JSON.stringify(serviceCountQueries[0]), /"deletedAt":null/);
  assert.match(JSON.stringify(serviceCountQueries[1]), /"status":"PUBLISHED"/);
});

test("web and MAUI expose provider profile navigation", () => {
  const controller = readFileSync(
    resolve(root, "api/src/modules/provider/public-provider.controller.ts"),
    "utf8",
  );
  const marketplace = readFileSync(
    resolve(root, "app/features/marketplace/MarketplaceViews.tsx"),
    "utf8",
  );
  const webProfile = readFileSync(
    resolve(root, "app/features/marketplace/PublicProviderProfileView.tsx"),
    "utf8",
  );
  const providerDashboard = readFileSync(
    resolve(root, "app/features/provider/ProviderDashboard.tsx"),
    "utf8",
  );
  const styles = readFileSync(resolve(root, "app/globals.css"), "utf8");
  const mobileBooking = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/Pages/ServiceBookingPage.cs"),
    "utf8",
  );
  const mobileProfile = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/Pages/PublicProviderProfilePage.cs"),
    "utf8",
  );

  assert.match(controller, /@Controller\("providers"\)/);
  assert.match(controller, /@Get\(":id\/reviews"\)/);
  assert.doesNotMatch(controller, /JwtAuthGuard/);
  assert.match(marketplace, /View .*public profile|View .*profile/i);
  assert.match(webProfile, /Published work/);
  assert.match(webProfile, /provider:stats-changed/);
  assert.match(webProfile, /visibilitychange/);
  assert.match(providerDashboard, /provider:stats-changed/);
  assert.match(providerDashboard, /provider:subscribe/);
  assert.match(
    styles,
    /\.provider-about-card > p[\s\S]*overflow-wrap: anywhere/,
  );
  assert.match(styles, /\.provider-profile-layout > \*[\s\S]*min-width: 0/);
  assert.match(mobileBooking, /PublicProviderProfilePage/);
  assert.match(mobileProfile, /PUBLISHED SERVICES/);
  assert.match(webProfile, /Contact and portfolio/);
  assert.match(webProfile, /noopener noreferrer nofollow/);
  assert.match(mobileProfile, /ProviderSocialLinkRules\.CanOpen/);
  assert.match(mobileProfile, /Launcher\.Default\.OpenAsync/);
  assert.match(mobileProfile, /OnProviderStatsChanged/);
});
