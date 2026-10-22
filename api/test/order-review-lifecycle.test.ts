import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { DisputesService } from "../src/modules/disputes/disputes.service";
import { OrderReviewReconciler } from "../src/modules/orders/order-review-reconciler.service";
import {
  isOrderReviewExpired,
  orderReviewWindow,
} from "../src/modules/orders/order-review.policy";
import { OrdersService } from "../src/modules/orders/orders.service";

// Keep the synthetic review window in the future so this race test remains
// deterministic as wall-clock time advances.
const startedAt = new Date("2036-10-06T00:00:00.000Z");
const deadline = new Date("2036-10-08T00:00:00.000Z");

function phaseFOrder() {
  const earning = {
    id: "earning-1",
    providerId: "provider-1",
    orderId: "order-1",
    paymentId: "payment-1",
    revisionPurchaseId: null,
    sourceType: "ORIGINAL_ORDER",
    grossServiceAmountCentavos: 50_000,
    currency: "PHP",
    status: "PENDING",
    pendingAt: new Date("2026-10-05T00:00:00Z"),
    availableAt: null as Date | null,
    ledgerEntries: [
      {
        id: "credit-1",
        type: "EARNING_PENDING_CREDIT",
        amountCentavos: 50_000,
        currency: "PHP",
      },
    ],
  };
  const order: any = {
    id: "order-1",
    orderNumber: "CG-F-1",
    clientId: "client-1",
    providerId: "provider-1",
    serviceId: "service-1",
    pricingModel: "SINGLE_PRICE_V2",
    deliveryDurationMinutes: 720,
    titleSnapshot: "Phase F delivery",
    status: "SUBMITTED",
    requirements: "Provide the final files.",
    subtotalCentavos: 50_000,
    platformFeeCentavos: 2_500,
    totalCentavos: 52_500,
    currency: "PHP",
    reviewPolicyVersion: 1,
    reviewStartedAt: startedAt,
    reviewDeadlineAt: deadline,
    reviewDeliverySubmissionId: "submission-1",
    completionSource: null,
    completedAt: null,
    createdAt: new Date("2026-10-05T00:00:00Z"),
    revisionsUsed: 0,
    revisionLimit: 1,
    client: { id: "client-1", displayName: "Client" },
    provider: { id: "provider-1", displayName: "Provider" },
    servicePackage: null,
    files: [],
    deliverySubmissions: [
      {
        id: "submission-1",
        providerId: "provider-1",
        version: 1,
        note: "Final delivery",
        submittedAt: startedAt,
        createdAt: startedAt,
        files: [],
      },
    ],
    revisions: [],
    disputes: [],
    review: null,
    payments: [
      {
        id: "payment-1",
        status: "PAID",
        amountCentavos: 52_500,
        platformFeeCentavos: 2_500,
        providerNetCentavos: 50_000,
        refundedCentavos: 0,
        currency: "PHP",
        paidAt: new Date("2026-10-05T00:00:00Z"),
        refunds: [],
      },
    ],
    providerEarnings: [earning],
  };
  return { order, earning };
}

function harness() {
  const { order, earning } = phaseFOrder();
  const history: any[] = [];
  const notifications: any[] = [];
  let stats = 0;
  let transactionTail = Promise.resolve<unknown>(undefined);

  const database: any = {
    $queryRaw: async () => [{ locked: true }],
    order: {
      findFirst: async ({ where }: any) => {
        if (where.id !== order.id) return null;
        if (where.clientId && where.clientId !== order.clientId) return null;
        if (
          where.OR &&
          !where.OR.some(
            (item: any) =>
              item.clientId === order.clientId ||
              item.providerId === order.providerId,
          )
        )
          return null;
        return order;
      },
      updateMany: async ({ where, data }: any) => {
        if (where.id !== order.id || where.status !== order.status)
          return { count: 0 };
        if (where.clientId && where.clientId !== order.clientId)
          return { count: 0 };
        const previousRevisionsUsed = order.revisionsUsed;
        Object.assign(order, data);
        if (data.revisionsUsed?.increment)
          order.revisionsUsed =
            previousRevisionsUsed + data.revisionsUsed.increment;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => order,
    },
    providerEarning: {
      updateMany: async ({ where, data }: any) => {
        if (where.id !== earning.id || earning.status !== where.status)
          return { count: 0 };
        if (where.availableAt === null && earning.availableAt !== null)
          return { count: 0 };
        Object.assign(earning, data);
        return { count: 1 };
      },
    },
    providerEarningLedgerEntry: {
      create: async ({ data }: any) => {
        if (earning.ledgerEntries.some((entry) => entry.type === data.type))
          throw new Error("duplicate release");
        earning.ledgerEntries.push({ id: "release-1", ...data });
        return data;
      },
    },
    orderStatusHistory: { create: async ({ data }: any) => history.push(data) },
    studentProfile: {
      update: async () => {
        stats += 1;
      },
    },
    notification: {
      create: async ({ data }: any) => notifications.push(data),
      createMany: async ({ data }: any) => notifications.push(...data),
    },
    revisionRequest: {
      findFirst: async () =>
        order.revisions.length
          ? { sequenceNumber: order.revisions.at(-1).sequenceNumber }
          : null,
      create: async ({ data }: any) => {
        order.revisions.push({ ...data, status: "OPEN" });
      },
    },
    orderDispute: {
      create: async ({ data }: any) => {
        const dispute = { id: "dispute-1", status: "OPEN", ...data };
        order.disputes.push(dispute);
        return dispute;
      },
    },
    disputeAffectedEarning: { create: async ({ data }: any) => data },
    disputeTimelineEvent: { createMany: async () => ({ count: 2 }) },
  };
  const prisma: any = {
    order: {
      findFirst: database.order.findFirst,
      findMany: async ({ where, take }: any) =>
        order.status === "SUBMITTED" &&
        order.reviewDeadlineAt <= where.reviewDeadlineAt.lte
          ? [{ id: order.id }].slice(0, take)
          : [],
    },
    orderDispute: {
      findUniqueOrThrow: async () => order.disputes.at(-1),
    },
    $transaction: <T>(operation: (client: typeof database) => Promise<T>) => {
      const result = transactionTail.then(() => operation(database));
      transactionTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  const events: string[] = [];
  const service = new OrdersService(
    prisma,
    undefined as never,
    undefined as never,
    {
      publishProviderStats: () => events.push("stats"),
      publishOrderChanged: () => events.push("order"),
    } as never,
  );
  return {
    service,
    disputes: new DisputesService(prisma, {} as never),
    order,
    earning,
    history,
    notifications,
    events,
    stats: () => stats,
  };
}

test("review policy uses the committed delivery time and exact inclusive deadline", () => {
  assert.deepEqual(orderReviewWindow(startedAt), {
    reviewStartedAt: startedAt,
    reviewDeadlineAt: deadline,
  });
  assert.equal(
    isOrderReviewExpired(deadline, new Date(deadline.getTime() - 1)),
    false,
  );
  assert.equal(isOrderReviewExpired(deadline, deadline), true);
  assert.equal(
    isOrderReviewExpired(deadline, new Date(deadline.getTime() + 1)),
    true,
  );
});

test("client acceptance completes and releases the unchanged principal exactly once", async () => {
  const state = harness();
  const [first, second] = await Promise.all([
    state.service.complete("client-1", "order-1"),
    state.service.complete("client-1", "order-1"),
  ]);
  assert.equal(first.data.status, "COMPLETED");
  assert.equal(second.data.status, "COMPLETED");
  assert.equal(state.order.completionSource, "CLIENT_ACCEPTED");
  assert.equal(state.earning.status, "AVAILABLE");
  assert.equal(state.earning.grossServiceAmountCentavos, 50_000);
  assert.deepEqual(
    state.earning.ledgerEntries.map((entry: any) => entry.amountCentavos),
    [50_000, 0],
  );
  assert.equal(state.history.length, 1);
  assert.equal(state.stats(), 1);
  assert.deepEqual(state.events, ["stats", "order"]);
});

test("accept and auto-complete race has one winner and one release", async () => {
  const state = harness();
  await Promise.all([
    state.service.complete("client-1", "order-1"),
    state.service.reconcileExpiredReview("order-1", deadline),
  ]);
  assert.equal(state.order.status, "COMPLETED");
  assert.equal(
    state.earning.ledgerEntries.filter(
      (entry: any) => entry.type === "EARNING_AVAILABLE_RELEASE",
    ).length,
    1,
  );
  assert.equal(state.stats(), 1);
});

test("revision and auto-complete serialize with the first transaction winning", async () => {
  const state = harness();
  const results = await Promise.allSettled([
    state.service.requestRevision(
      "client-1",
      "order-1",
      "Please adjust the final export.",
    ),
    state.service.reconcileExpiredReview("order-1", deadline),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(state.order.status, "REVISION_REQUESTED");
  assert.equal(state.order.reviewDeadlineAt, null);
  assert.equal(state.earning.status, "PENDING");
});

test("dispute and auto-complete serialize while freezing the pending earning", async () => {
  const state = harness();
  const results = await Promise.allSettled([
    state.disputes.open(
      "client-1",
      "order-1",
      "QUALITY_ISSUE",
      "The delivered work needs administrator review.",
    ),
    state.service.reconcileExpiredReview("order-1", deadline),
  ]);
  assert.equal(results[0].status, "fulfilled");
  if (results[1].status === "fulfilled") {
    assert.equal(state.order.status, "COMPLETED");
    assert.equal(state.order.completionSource, "AUTO_REVIEW_TIMEOUT");
  } else {
    assert.ok(results[1].reason instanceof ConflictException);
    assert.equal(state.order.status, "SUBMITTED");
  }
  assert.equal(state.earning.status, "FROZEN");
  assert.equal(
    state.earning.ledgerEntries.filter(
      (entry: any) => entry.type === "EARNING_FROZEN",
    ).length,
    1,
  );
  assert.equal(
    state.earning.ledgerEntries.filter(
      (entry: any) => entry.type === "EARNING_AVAILABLE_RELEASE",
    ).length,
    results[1].status === "fulfilled" ? 1 : 0,
  );
});

test("duplicate workers and worker/lazy reconciliation release once", async () => {
  for (const mode of ["auto-auto", "worker-lazy"] as const) {
    const state = harness();
    const config = {
      get: (key: string) =>
        key === "ORDER_REVIEW_BATCH_SIZE" ? "25" : undefined,
    };
    const worker = new OrderReviewReconciler(state.service, config as never);
    const secondWorker = new OrderReviewReconciler(
      state.service,
      config as never,
    );
    const operations =
      mode === "auto-auto"
        ? [worker.runOnce(deadline), secondWorker.runOnce(deadline)]
        : [
            worker.runOnce(deadline),
            state.service.reconcileExpiredReview("order-1", deadline),
          ];
    await Promise.all(operations);
    worker.onModuleDestroy();
    secondWorker.onModuleDestroy();
    assert.equal(state.order.completionSource, "AUTO_REVIEW_TIMEOUT");
    assert.equal(state.earning.ledgerEntries.length, 2);
    assert.equal(state.stats(), 1);
  }
});

test("stale deadline cannot complete a newer delivery review", async () => {
  const state = harness();
  state.order.reviewStartedAt = new Date("2036-10-07T00:00:00Z");
  state.order.reviewDeadlineAt = new Date("2036-10-09T00:00:00Z");
  state.order.reviewDeliverySubmissionId = "submission-2";
  state.order.deliverySubmissions = [
    { id: "submission-2", submittedAt: state.order.reviewStartedAt },
  ];
  await assert.rejects(
    state.service.reconcileExpiredReview("order-1", deadline),
    ConflictException,
  );
  assert.equal(state.order.status, "SUBMITTED");
  assert.equal(state.earning.status, "PENDING");
});

test("acceptance rejects wrong client and accounting inconsistencies safely", async () => {
  const unauthorized = harness();
  await assert.rejects(
    unauthorized.service.complete("other-client", "order-1"),
    NotFoundException,
  );

  const missingEarning = harness();
  missingEarning.order.providerEarnings = [];
  await assert.rejects(
    missingEarning.service.complete("client-1", "order-1"),
    /earning is missing/i,
  );
  assert.equal(missingEarning.order.status, "SUBMITTED");

  const refunded = harness();
  refunded.order.payments[0].refundedCentavos = 1;
  await assert.rejects(
    refunded.service.reconcileExpiredReview("order-1", deadline),
    /unreimbursed payment/i,
  );
  assert.equal(refunded.earning.status, "PENDING");
});

test("reconciler is bounded, retries safely, and continues after one failed order", async () => {
  const attempts: string[] = [];
  let failFirst = true;
  const orders = {
    expiredReviewOrderIds: async (_now: Date, limit: number) => {
      assert.equal(limit, 2);
      return ["order-a", "order-b"];
    },
    reconcileExpiredReview: async (id: string) => {
      attempts.push(id);
      if (id === "order-a" && failFirst) throw new Error("temporary failure");
      return { transitioned: true };
    },
  };
  const config = {
    get: (key: string) => (key === "ORDER_REVIEW_BATCH_SIZE" ? "2" : undefined),
  };
  const worker = new OrderReviewReconciler(orders as never, config as never);
  assert.deepEqual(await worker.runOnce(deadline), {
    examined: 2,
    completed: 1,
    failed: 1,
  });
  failFirst = false;
  assert.deepEqual(await worker.runOnce(deadline), {
    examined: 2,
    completed: 2,
    failed: 0,
  });
  assert.deepEqual(attempts, ["order-a", "order-b", "order-a", "order-b"]);
  worker.onModuleDestroy();
});

test("Phase F migration is additive and intentionally has no historical backfill", () => {
  const root = resolve(import.meta.dirname, "../..");
  const migration = readFileSync(
    resolve(
      root,
      "api/prisma/migrations/20261006030000_add_delivery_review_and_earning_release/migration.sql",
    ),
    "utf8",
  );
  assert.match(migration, /OrderCompletionSource/);
  assert.match(migration, /EARNING_AVAILABLE_RELEASE/);
  assert.match(migration, /reviewDeliverySubmissionId/);
  assert.match(migration, /Order_status_reviewDeadlineAt_id_idx/);
  assert.doesNotMatch(
    migration,
    /UPDATE\s+"Order"|UPDATE\s+"ProviderEarning"|DELETE\s+FROM|DROP\s+(TABLE|COLUMN)/i,
  );
});
