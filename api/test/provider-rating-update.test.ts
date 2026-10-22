import assert from "node:assert/strict";
import test from "node:test";
import { OrdersService } from "../src/modules/orders/orders.service";

test("submitting a review atomically refreshes the provider rating", async () => {
  const order = {
    id: "order-1",
    clientId: "client-1",
    providerId: "provider-1",
    titleSnapshot: "Logo Design",
    status: "COMPLETED",
    provider: { displayName: "Campus Designer" },
  };
  let ratingUpdate: any;
  let notification: any;
  let publishedEvent: unknown;
  const createdReview = { id: "review-1", overallRating: 5 };
  let providerRowLocked = false;
  const database = {
    $queryRaw: async () => {
      providerRowLocked = true;
      return [{ userId: "provider-1" }];
    },
    review: {
      create: async () => createdReview,
      aggregate: async () => ({
        _avg: { overallRating: 4.75 },
        _count: { _all: 8 },
      }),
    },
    studentProfile: {
      update: async (input: unknown) => (ratingUpdate = input),
    },
    notification: {
      create: async (input: unknown) => (notification = input),
    },
  };
  const prisma = {
    order: { findFirst: async () => order },
    payment: { findFirst: async () => ({ id: "payment-1" }) },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };

  const realtime = {
    publishProviderStats: (providerId: string, reason: string) => {
      publishedEvent = { providerId, reason };
    },
  };
  const result = await new OrdersService(
    prisma as never,
    undefined as never,
    undefined as never,
    realtime as never,
  ).review("client-1", "order-1", {
    overallRating: 5,
    qualityRating: 5,
    communicationRating: 4,
    timelinessRating: 5,
    comment: "Excellent work.",
  });

  assert.equal(result.data, createdReview);
  assert.equal(providerRowLocked, true);
  assert.deepEqual(ratingUpdate, {
    where: { userId: "provider-1" },
    data: { ratingAverage: 4.75, reviewCount: 8 },
  });
  assert.equal(notification.data.type, "NEW_REVIEW");
  assert.equal(notification.data.recipientId, "provider-1");
  assert.deepEqual(publishedEvent, {
    providerId: "provider-1",
    reason: "review",
  });
});

test("completing an order atomically increments completed work and publishes refresh", async () => {
  const order = {
    id: "order-1",
    clientId: "client-1",
    providerId: "provider-1",
    titleSnapshot: "Logo Design",
    status: "SUBMITTED",
    provider: { id: "provider-1", displayName: "Campus Designer" },
    client: { id: "client-1", displayName: "Campus Client" },
    servicePackage: { id: "package-1", name: "Basic" },
    files: [],
    revisions: [],
    disputes: [],
    review: null,
    payments: [{ status: "PAID" }],
  };
  let profileUpdate: any;
  let publishedEvent: unknown;
  const completed = { ...order, status: "COMPLETED" };
  const database = {
    $queryRaw: async () => [{ locked: true }],
    order: {
      findFirst: async () => order,
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => completed,
    },
    orderStatusHistory: { create: async () => undefined },
    studentProfile: {
      update: async (input: unknown) => (profileUpdate = input),
    },
    notification: { create: async () => undefined },
  };
  const prisma = {
    order: { findFirst: async () => order },
    payment: { findFirst: async () => ({ id: "payment-1" }) },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };
  const realtime = {
    publishProviderStats: (providerId: string, reason: string) => {
      publishedEvent = { providerId, reason };
    },
  };

  const result = await new OrdersService(
    prisma as never,
    undefined as never,
    undefined as never,
    realtime as never,
  ).complete("client-1", "order-1");

  assert.equal(result.data.status, "COMPLETED");
  assert.deepEqual(profileUpdate, {
    where: { userId: "provider-1" },
    data: { completedOrderCount: { increment: 1 } },
  });
  assert.deepEqual(publishedEvent, {
    providerId: "provider-1",
    reason: "completion",
  });
});
