import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { OrdersService } from "../src/modules/orders/orders.service";
import {
  paidExtraRevisionQuote,
  revisionDeadlineAt,
  revisionTurnaroundMinutes,
} from "../src/modules/orders/revision-policy";
import { PaymentLedgerService } from "../src/modules/payments/payment-ledger.service";

test("extra-revision pricing uses integer ceilings, the PHP 20 minimum, and preserves currency", () => {
  const examples = [
    [10_000, 2_000, 100, 2_100],
    [20_000, 2_000, 100, 2_100],
    [50_000, 5_000, 250, 5_250],
    [70_000, 7_000, 350, 7_350],
    [100_000, 10_000, 500, 10_500],
  ] as const;
  for (const [basis, subtotal, fee, total] of examples) {
    const quote = paidExtraRevisionQuote(basis, "php", 1_440);
    assert.equal(quote.providerSubtotalCentavos, subtotal);
    assert.equal(quote.platformFeeCentavos, fee);
    assert.equal(quote.clientTotalCentavos, total);
    assert.equal(quote.currency, "PHP");
    assert.equal(quote.pricingBasisCentavos, basis);
  }

  const centavoEdge = paidExtraRevisionQuote(20_001, "usd", 361);
  assert.equal(centavoEdge.providerSubtotalCentavos, 2_001);
  assert.equal(centavoEdge.platformFeeCentavos, 101);
  assert.equal(centavoEdge.clientTotalCentavos, 2_102);
  assert.equal(centavoEdge.currency, "USD");
  assert.throws(() => paidExtraRevisionQuote(10_000.5, "PHP", 360));
  assert.throws(() => paidExtraRevisionQuote(10_000, "peso", 360));
});

test("revision turnaround is half the immutable duration with locked bounds and deadline", () => {
  assert.equal(revisionTurnaroundMinutes(120), 180);
  assert.equal(revisionTurnaroundMinutes(360), 180);
  assert.equal(revisionTurnaroundMinutes(361), 181);
  assert.equal(revisionTurnaroundMinutes(720), 360);
  assert.equal(revisionTurnaroundMinutes(1_440), 720);
  assert.equal(revisionTurnaroundMinutes(10_080), 4_320);
  const paidAt = new Date("2026-10-07T01:02:03.000Z");
  assert.equal(
    revisionDeadlineAt(paidAt, 181).toISOString(),
    "2026-10-07T04:03:03.000Z",
  );
});

test("a client correction claim cannot self-authorize free work or consume allowance", async () => {
  const created: Record<string, unknown>[] = [];
  const order = {
    id: "order-1",
    status: "SUBMITTED",
    providerId: "provider-1",
    titleSnapshot: "Original work",
    pricingModel: "SINGLE_PRICE_V2",
    deliveryDurationMinutes: 720,
    termsSnapshot: null,
    reviewPolicyVersion: 1,
    reviewDeadlineAt: new Date("2099-01-02T00:00:00Z"),
    reviewDeliverySubmissionId: "delivery-1",
    deliverySubmissions: [{ id: "delivery-1" }],
    payments: [{ id: "payment-1", refundedCentavos: 0, refunds: [] }],
    revisions: [],
    disputes: [],
  };
  const database = {
    $queryRaw: async () => [{ locked: true }],
    order: { findFirst: async () => order },
    revisionRequest: {
      findFirst: async ({ orderBy }: { orderBy?: unknown }) =>
        orderBy ? null : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const revision = { id: "revision-1", ...data };
        created.push(revision);
        return revision;
      },
    },
    notification: { create: async () => undefined },
  };
  const prisma = {
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };
  const service = new OrdersService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  const result = await service.requestProviderCorrection(
    "client-1",
    order.id,
    "The required PDF was omitted.",
  );
  assert.equal(result.data.type, "PROVIDER_CORRECTION");
  assert.equal(result.data.status, "AWAITING_PROVIDER_ACKNOWLEDGEMENT");
  assert.equal(result.data.revisionDeadlineAt, undefined);
  assert.equal(created.length, 1);
  assert.equal("revisionsUsed" in created[0], false);
  assert.equal("payment" in created[0], false);
});

test("only the provider can acknowledge a correction and acknowledgement remains free", async () => {
  const revision: any = {
    id: "revision-1",
    orderId: "order-1",
    sequenceNumber: 1,
    type: "PROVIDER_CORRECTION",
    status: "AWAITING_PROVIDER_ACKNOWLEDGEMENT",
    instructions: "The required PDF was omitted.",
    sourceDeliverySubmissionId: "delivery-1",
    turnaroundMinutes: 360,
    order: {
      id: "order-1",
      clientId: "client-1",
      providerId: "provider-1",
      titleSnapshot: "Original work",
      status: "SUBMITTED",
      reviewPolicyVersion: 1,
      reviewDeadlineAt: new Date("2099-01-02T00:00:00Z"),
      reviewDeliverySubmissionId: "delivery-1",
      deliverySubmissions: [{ id: "delivery-1" }],
      payments: [{ id: "payment-1", refundedCentavos: 0, refunds: [] }],
      revisions: [],
      disputes: [],
    },
  };
  let orderUpdate: Record<string, unknown> | null = null;
  const database = {
    $queryRaw: async () => [{ locked: true }],
    revisionRequest: {
      findFirst: async ({ where }: any) =>
        where.order.providerId === revision.order.providerId ? revision : null,
      update: async ({ data }: any) => {
        Object.assign(revision, data);
        return revision;
      },
    },
    order: {
      updateMany: async ({ data }: any) => {
        orderUpdate = data;
        return { count: 1 };
      },
    },
    orderStatusHistory: { create: async () => undefined },
    notification: { create: async () => undefined },
  };
  const prisma = {
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };
  const service = new OrdersService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );

  await assert.rejects(
    service.decideProviderCorrection(
      "unrelated-provider",
      revision.orderId,
      revision.id,
      true,
    ),
    /not found/i,
  );
  await service.decideProviderCorrection(
    revision.order.providerId,
    revision.orderId,
    revision.id,
    true,
  );
  assert.equal(revision.status, "OPEN");
  assert.ok(revision.providerAcknowledgedAt instanceof Date);
  assert.ok(revision.revisionDeadlineAt instanceof Date);
  assert.equal(orderUpdate?.status, "REVISION_REQUESTED");
  assert.equal("revisionsUsed" in orderUpdate!, false);
  assert.equal("payment" in orderUpdate!, false);
});

function paidRevisionHarness(stale = false) {
  const paidAt = new Date("2026-10-07T08:00:00.000Z");
  const purchase: any = {
    id: "purchase-1",
    orderId: "order-1",
    sourceDeliverySubmissionId: "delivery-1",
    instructions: "Adjust the approved layout spacing.",
    providerSubtotalCentavos: 7_000,
    platformFeeCentavos: 350,
    totalCentavos: 7_350,
    currency: "PHP",
    turnaroundMinutes: 360,
    paymentStatus: "REQUIRES_ACTION",
    activationStatus: "PENDING",
    failureCode: null,
    paidAt: null,
    activatedAt: null,
  };
  const order: any = {
    id: "order-1",
    clientId: "client-1",
    providerId: "provider-1",
    titleSnapshot: "Original work",
    status: "SUBMITTED",
    revisionsUsed: 1,
    revisionLimit: 1,
    reviewPolicyVersion: 1,
    reviewDeadlineAt: new Date("2026-10-08T08:00:00.000Z"),
    reviewDeliverySubmissionId: stale ? "delivery-2" : "delivery-1",
    deliverySubmissions: [{ id: stale ? "delivery-2" : "delivery-1" }],
    revisions: [],
    disputes: [],
  };
  const revisions: any[] = [];
  const earnings: any[] = [];
  const histories: any[] = [];
  const notifications: any[] = [];
  const database = {
    $queryRaw: async () => [{ locked: true }],
    orderRevisionPurchase: {
      findUniqueOrThrow: async () => ({ ...purchase, order }),
      updateMany: async ({ data }: any) => {
        if (!["PENDING", "REQUIRES_ACTION"].includes(purchase.paymentStatus))
          return { count: 0 };
        Object.assign(purchase, data);
        return { count: 1 };
      },
      update: async ({ data }: any) => {
        Object.assign(purchase, data);
        return purchase;
      },
    },
    revisionRequest: {
      findFirst: async () =>
        revisions.length
          ? { sequenceNumber: revisions.at(-1).sequenceNumber }
          : null,
      create: async ({ data }: any) => {
        const revision = { id: `revision-${revisions.length + 1}`, ...data };
        revisions.push(revision);
        return revision;
      },
    },
    order: {
      updateMany: async ({ data }: any) => {
        if (stale || order.status !== "SUBMITTED") return { count: 0 };
        Object.assign(order, data);
        return { count: 1 };
      },
    },
    providerEarning: {
      create: async ({ data }: any) => {
        earnings.push(data);
        return data;
      },
    },
    orderStatusHistory: {
      create: async ({ data }: any) => histories.push(data),
    },
    notification: {
      createMany: async ({ data }: any) => notifications.push(...data),
    },
    paymentWebhookEvent: { update: async () => undefined },
  };
  let transactionTail = Promise.resolve<unknown>(undefined);
  const prisma = {
    $transaction: <T>(operation: (client: typeof database) => Promise<T>) => {
      const result = transactionTail.then(() => operation(database));
      transactionTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  const service = new PaymentLedgerService(prisma as never, {} as never);
  const recognize = () =>
    (service as any).markRevisionPaid(
      { id: purchase.id, orderId: purchase.orderId },
      "paymongo-payment-1",
      undefined,
      paidAt,
    );
  return {
    recognize,
    paidAt,
    purchase,
    order,
    revisions,
    earnings,
    histories,
    notifications,
  };
}

test("authoritative paid activation is idempotent and creates one separate pending earning", async () => {
  const state = paidRevisionHarness();
  const [first, duplicate] = await Promise.all([
    state.recognize(),
    state.recognize(),
  ]);
  assert.equal(first.activated, true);
  assert.equal(duplicate.transitioned, false);
  assert.equal(state.purchase.paymentStatus, "PAID");
  assert.equal(state.purchase.activationStatus, "ACTIVATED");
  assert.equal(state.order.status, "REVISION_REQUESTED");
  assert.equal(state.revisions.length, 1);
  assert.equal(state.revisions[0].type, "PAID_EXTRA");
  assert.equal(state.revisions[0].sourceDeliverySubmissionId, "delivery-1");
  assert.equal(
    state.revisions[0].revisionDeadlineAt.toISOString(),
    "2026-10-07T14:00:00.000Z",
  );
  assert.equal(state.earnings.length, 1);
  assert.equal(state.earnings[0].sourceType, "PAID_EXTRA_REVISION");
  assert.equal(state.earnings[0].grossServiceAmountCentavos, 7_000);
  assert.equal(state.earnings[0].status, "PENDING");
  assert.equal(state.earnings[0].revisionPurchaseId, state.purchase.id);
  assert.equal(
    state.earnings[0].ledgerEntries.create.amountCentavos,
    7_000,
  );
  assert.equal(state.histories.length, 1);
  assert.equal(state.notifications.length, 2);
});

test("a successfully paid stale checkout records payment truth without activation, earning, or refund", async () => {
  const state = paidRevisionHarness(true);
  const result = await state.recognize();
  assert.equal(result.activated, false);
  assert.equal(state.purchase.paymentStatus, "PAID");
  assert.equal(state.purchase.activationStatus, "RECONCILIATION_REQUIRED");
  assert.equal(state.purchase.failureCode, "stale_order_state_after_payment");
  assert.equal(state.revisions.length, 0);
  assert.equal(state.earnings.length, 0);
  assert.equal(state.order.status, "SUBMITTED");
});

test("Phase G migration is additive and enforces payment, earning, and active-checkout identities", () => {
  const root = resolve(import.meta.dirname, "../..");
  const migration = readFileSync(
    resolve(
      root,
      "api/prisma/migrations/20261007030000_add_paid_extra_revisions/migration.sql",
    ),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "OrderRevisionPurchase"/);
  assert.match(migration, /ProviderEarningSource/);
  assert.match(migration, /sourceRevisionPurchaseId/);
  assert.match(migration, /OrderRevisionPurchase_one_active_per_delivery/);
  assert.match(migration, /ProviderEarning_revisionPurchaseId_key/);
  assert.match(migration, /ProviderEarning_one_original_per_order/);
  assert.match(migration, /DROP INDEX "ProviderEarning_orderId_key"/);
  assert.doesNotMatch(
    migration,
    /UPDATE\s+"RevisionRequest"|INSERT\s+INTO\s+"OrderRevisionPurchase"|DELETE\s+FROM|DROP\s+(TABLE|COLUMN)/i,
  );
});

test("Phase G routes preserve dispute separation and contain no refund or payout mechanics", () => {
  const root = resolve(import.meta.dirname, "../..");
  const ordersController = readFileSync(
    resolve(root, "api/src/modules/orders/orders.controller.ts"),
    "utf8",
  );
  const paymentsController = readFileSync(
    resolve(root, "api/src/modules/payments/payments.controller.ts"),
    "utf8",
  );
  const payments = readFileSync(
    resolve(root, "api/src/modules/payments/payment-ledger.service.ts"),
    "utf8",
  );
  assert.match(ordersController, /revisions\/correction-claim/);
  assert.match(ordersController, /revisions\/:revisionId\/correction-decision/);
  assert.match(paymentsController, /@Get\("revision-quote"\)/);
  assert.match(paymentsController, /@Post\("revision-checkout"\)/);
  assert.match(payments, /stale_order_state_after_payment/);
  assert.match(payments, /RECONCILIATION_REQUIRED/);
  assert.doesNotMatch(payments, /createRefund|refundPayment|payoutProvider/);
});
