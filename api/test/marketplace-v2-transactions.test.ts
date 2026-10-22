import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeliveryOption, RushTier } from "@prisma/client";
import { MarketplacePricingPolicy } from "../src/modules/marketplace-pricing/marketplace-pricing.policy";
import { ServicesService } from "../src/modules/services/services.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import {
  calculateV2Deadline,
  PaymentLedgerService,
} from "../src/modules/payments/payment-ledger.service";
import { paymongoTimestamp } from "../src/modules/payments/paymongo.client";

const config = {
  get(key: string) {
    return {
      PLATFORM_FEE_BASIS_POINTS: "500",
      PLATFORM_FEE_MIN_CENTAVOS: "0",
      RUSH_24_HOURS_BASIS_POINTS: "2000",
      RUSH_12_HOURS_BASIS_POINTS: "3000",
      RUSH_6_HOURS_BASIS_POINTS: "4000",
      RUSH_3_HOURS_BASIS_POINTS: "5000",
    }[key];
  },
};

const policy = new MarketplacePricingPolicy(config as never);
const terms = {
  basePriceCentavos: 50_000,
  normalDeliveryMinutes: 3 * 1440,
  includedRevisionLimit: 2,
  acceptsRushOrders: true,
  fastestRushTier: RushTier.HOURS_3,
};

test("pricing policy applies exact Phase C centavo arithmetic", () => {
  const expected = [
    [DeliveryOption.NORMAL, 0, 50_000, 2_500, 52_500],
    [DeliveryOption.RUSH_24_HOURS, 10_000, 60_000, 3_000, 63_000],
    [DeliveryOption.RUSH_12_HOURS, 15_000, 65_000, 3_250, 68_250],
    [DeliveryOption.RUSH_6_HOURS, 20_000, 70_000, 3_500, 73_500],
    [DeliveryOption.RUSH_3_HOURS, 25_000, 75_000, 3_750, 78_750],
  ] as const;
  for (const [option, rush, subtotal, fee, total] of expected) {
    const quote = policy.quote(terms, option);
    assert.equal(quote.rushSurchargeCentavos, rush);
    assert.equal(quote.providerServiceSubtotalCentavos, subtotal);
    assert.equal(quote.platformFeeCentavos, fee);
    assert.equal(quote.clientTotalCentavos, total);
    assert.equal(quote.pricingPolicyVersion, 1);
  }
});

test("pricing uses ceiling arithmetic and no fee minimum", () => {
  const quote = policy.quote(
    {
      ...terms,
      basePriceCentavos: 10_001,
      acceptsRushOrders: false,
      fastestRushTier: null,
    },
    DeliveryOption.NORMAL,
  );
  assert.equal(quote.platformFeeCentavos, 501);
  const small = policy.quote(
    {
      ...terms,
      basePriceCentavos: 100,
      acceptsRushOrders: false,
      fastestRushTier: null,
    },
    DeliveryOption.NORMAL,
  );
  assert.equal(small.platformFeeCentavos, 5);
});

test("rush eligibility follows normal and provider-fastest boundaries", () => {
  assert.deepEqual(
    policy.eligibleDeliveryOptions({
      ...terms,
      fastestRushTier: RushTier.HOURS_6,
    }),
    ["NORMAL", "RUSH_24_HOURS", "RUSH_12_HOURS", "RUSH_6_HOURS"],
  );
  assert.deepEqual(
    policy.eligibleDeliveryOptions({ ...terms, normalDeliveryMinutes: 1440 }),
    ["NORMAL", "RUSH_12_HOURS", "RUSH_6_HOURS", "RUSH_3_HOURS"],
  );
  assert.deepEqual(
    policy.eligibleDeliveryOptions({
      ...terms,
      normalDeliveryMinutes: 720,
      fastestRushTier: RushTier.HOURS_6,
    }),
    ["NORMAL", "RUSH_6_HOURS"],
  );
  assert.deepEqual(
    policy.eligibleDeliveryOptions({
      ...terms,
      acceptsRushOrders: false,
      fastestRushTier: null,
    }),
    ["NORMAL"],
  );
  assert.throws(
    () =>
      policy.quote(
        { ...terms, fastestRushTier: RushTier.HOURS_6 },
        DeliveryOption.RUSH_3_HOURS,
      ),
    /not available/i,
  );
});

test("exact V2 deadlines cross midnight without end-of-day rounding", () => {
  assert.equal(
    calculateV2Deadline(new Date("2026-10-05T09:36:00Z"), 6 * 60).toISOString(),
    "2026-10-05T15:36:00.000Z",
  );
  assert.equal(
    calculateV2Deadline(new Date("2026-10-05T23:30:00Z"), 3 * 60).toISOString(),
    "2026-10-06T02:30:00.000Z",
  );
});

test("quote is read-only and rejects self-ordering", async () => {
  let orderWrites = 0;
  const prisma = {
    service: {
      findFirst: async () => ({
        providerId: "provider-1",
        basePriceCentavos: 50_000,
        normalDeliveryMinutes: 4320,
        includedRevisionLimit: 2,
        acceptsRushOrders: true,
        fastestRushTier: RushTier.HOURS_6,
        provider: { providerProfile: { maxPendingOrders: 50 } },
      }),
    },
    order: { create: async () => orderWrites++, count: async () => 0 },
  };
  const service = new ServicesService(prisma as never, policy);
  const result = await service.quote(
    "client-1",
    "service-1",
    DeliveryOption.RUSH_6_HOURS,
  );
  assert.equal(result.data.clientTotalCentavos, 73_500);
  assert.equal(orderWrites, 0);
  await assert.rejects(
    () => service.quote("provider-1", "service-1", DeliveryOption.NORMAL),
    /cannot order your own service/i,
  );
});

test("V2 order creation recalculates and snapshots terms without a package or deadline", async () => {
  let createdData: any;
  const serviceRecord = {
    id: "service-1",
    providerId: "provider-1",
    title: "V2 design service",
    pricingModel: "SINGLE_PRICE_V2",
    basePriceCentavos: 50_000,
    normalDeliveryMinutes: 4320,
    includedRevisionLimit: 2,
    acceptsRushOrders: true,
    fastestRushTier: RushTier.HOURS_6,
    provider: {
      displayName: "Provider",
      providerProfile: { isAvailable: true },
    },
    packages: [],
  };
  const responseOrder = (data: any) => ({
    id: "order-1",
    ...data,
    createdAt: new Date("2026-10-05T00:00:00Z"),
    client: {
      id: "client-1",
      displayName: "Client",
      avatarPath: null,
      updatedAt: new Date(0),
    },
    provider: {
      id: "provider-1",
      displayName: "Provider",
      avatarPath: null,
      updatedAt: new Date(0),
    },
    servicePackage: null,
    files: [],
    revisions: [],
    review: null,
    payments: [],
    revisionsUsed: 0,
    status: "REQUESTED",
  });
  const database = {
    $queryRaw: async () => [{ locked: true }],
    providerProfile: {
      findUnique: async () => ({ isAvailable: true, maxPendingOrders: 50 }),
    },
    order: {
      count: async () => 0,
      create: async ({ data }: any) => {
        createdData = data;
        return responseOrder(data);
      },
    },
  };
  const prisma = {
    service: { findFirst: async () => serviceRecord },
    $transaction: async (callback: (database: any) => unknown) =>
      callback(database),
  };
  const orders = new OrdersService(
    prisma as never,
    config as never,
    {} as never,
    undefined,
    policy,
  );
  const result = await orders.create("client-1", {
    serviceId: "service-1",
    deliveryOption: DeliveryOption.RUSH_6_HOURS,
    requirements: "Create a complete brand identity.",
  });
  assert.equal(createdData.pricingModel, "SINGLE_PRICE_V2");
  assert.equal(createdData.servicePackageId, null);
  assert.equal(createdData.packageSnapshot.constructor.name, "DbNull");
  assert.equal(createdData.dueAt, null);
  assert.equal(createdData.subtotalCentavos, 70_000);
  assert.equal(createdData.platformFeeCentavos, 3_500);
  assert.equal(createdData.totalCentavos, 73_500);
  assert.equal(createdData.termsSnapshot.pricing.clientTotalCentavos, 73_500);
  assert.equal(createdData.termsSnapshot.includedRevisionLimit, 2);
  assert.equal(result.data.package, undefined);

  serviceRecord.basePriceCentavos = 99_999;
  serviceRecord.includedRevisionLimit = 9;
  assert.equal(createdData.termsSnapshot.pricing.basePriceCentavos, 50_000);
  assert.equal(createdData.termsSnapshot.includedRevisionLimit, 2);
});

test("create-order contract exposes no client-controlled financial or deadline fields", async () => {
  const source = await readFile(
    new URL("../src/modules/orders/dto/create-order.dto.ts", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "basePriceCentavos",
    "rushSurchargeCentavos",
    "platformFeeCentavos",
    "platformFeeBasisPoints",
    "rushBasisPoints",
    "totalCentavos",
    "dueAt",
    "paidAt",
  ])
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`));
});

test("acceptance and checkout creation cannot start the V2 deadline", async () => {
  const ordersSource = await readFile(
    new URL("../src/modules/orders/orders.service.ts", import.meta.url),
    "utf8",
  );
  const acceptBody = ordersSource.slice(
    ordersSource.indexOf("  async accept("),
    ordersSource.indexOf("  private async lockProviderWorkload("),
  );
  assert.match(
    acceptBody,
    /data: \{ status: "ACCEPTED", acceptedAt: new Date\(\) \}/,
  );
  assert.doesNotMatch(acceptBody, /dueAt/);

  const paymentsSource = await readFile(
    new URL(
      "../src/modules/payments/payment-ledger.service.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const checkoutBody = paymentsSource.slice(
    paymentsSource.indexOf("  async createCheckout("),
    paymentsSource.indexOf("  async processWebhook("),
  );
  assert.doesNotMatch(checkoutBody, /dueAt|paidAt/);
});

test("PayMongo timestamp is parsed only from a valid Unix-second value", () => {
  assert.equal(
    paymongoTimestamp(1_799_000_000)?.toISOString(),
    "2027-01-03T18:13:20.000Z",
  );
  assert.equal(paymongoTimestamp("1799000000"), null);
  assert.equal(paymongoTimestamp(undefined), null);
});

test("first paid transition sets exact V2 deadline once and amount mismatch sets none", async () => {
  const confirmedSeconds = Math.floor(
    Date.parse("2026-10-05T09:36:00Z") / 1000,
  );
  let transition = 1;
  const deadlines: Date[] = [];
  let earningCount = 0;
  const database = {
    payment: {
      updateMany: async () => ({ count: transition-- > 0 ? 1 : 0 }),
      findUniqueOrThrow: async () => ({
        id: "payment-1",
        amountCentavos: 73_500,
        platformFeeCentavos: 3_500,
        providerNetCentavos: 70_000,
        currency: "PHP",
        paidAt: new Date(confirmedSeconds * 1000),
        order: {
          id: "order-1",
          providerId: "provider-1",
          pricingModel: "SINGLE_PRICE_V2",
          subtotalCentavos: 70_000,
          platformFeeCentavos: 3_500,
          totalCentavos: 73_500,
          currency: "PHP",
        },
      }),
    },
    providerEarning: {
      create: async () => {
        earningCount += 1;
        return { id: `earning-${earningCount}` };
      },
    },
    orderDispute: { findFirst: async () => null },
    order: {
      updateMany: async ({ data }: any) => {
        deadlines.push(data.dueAt);
        return { count: 1 };
      },
    },
    notification: { createMany: async () => ({ count: 2 }) },
    paymentWebhookEvent: { update: async () => ({}) },
    $queryRaw: async () => [{ locked: true }],
  };
  let event = 0;
  const prisma = {
    paymentWebhookEvent: {
      create: async () => ({ id: `event-${++event}`, processedAt: null }),
      update: async () => ({}),
    },
    payment: {
      findUnique: async () => ({
        id: "payment-1",
        orderId: "order-1",
        amountCentavos: 73_500,
        currency: "PHP",
      }),
    },
    orderRevisionPurchase: { findUnique: async () => null },
    order: {
      findUniqueOrThrow: async () => ({
        clientId: "client-1",
        providerId: "provider-1",
        titleSnapshot: "V2 design service",
        pricingModel: "SINGLE_PRICE_V2",
        deliveryDurationMinutes: 360,
      }),
    },
    $transaction: async (callback: (database: any) => unknown) =>
      callback(database),
  };
  const ledger = new PaymentLedgerService(prisma as never, {} as never);
  const payload = (id: string, amount = 73_500) => ({
    data: {
      id,
      type: "event" as const,
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: false,
        data: {
          id: "checkout-1",
          type: "checkout_session",
          attributes: {
            payments: [
              {
                id: "paymongo-payment-1",
                attributes: {
                  amount,
                  currency: "PHP",
                  paid_at: confirmedSeconds,
                },
              },
            ],
          },
        },
      },
    },
  });
  await ledger.processWebhook(payload("provider-event-1"));
  await ledger.processWebhook(payload("provider-event-2"));
  assert.equal(deadlines.length, 1);
  assert.equal(earningCount, 1);
  assert.equal(deadlines[0].toISOString(), "2026-10-05T15:36:00.000Z");
  await assert.rejects(
    () => ledger.processWebhook(payload("provider-event-3", 73_499)),
    /does not match/,
  );
  assert.equal(deadlines.length, 1);
});

test("Phase C migration is additive and preserves legacy package history", async () => {
  const sql = await readFile(
    new URL(
      "../prisma/migrations/20261005100000_add_v2_transaction_terms/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /ALTER COLUMN "servicePackageId" DROP NOT NULL/);
  assert.match(sql, /ALTER COLUMN "packageSnapshot" DROP NOT NULL/);
  assert.match(sql, /ALTER COLUMN "dueAt" DROP NOT NULL/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE "Order"|DROP COLUMN/);
});
