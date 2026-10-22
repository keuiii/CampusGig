import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { InternalServerErrorException } from "@nestjs/common";
import { PaymentLedgerService } from "../src/modules/payments/payment-ledger.service";
import {
  pendingEarningCreditSourceKey,
  providerEarningPrincipal,
} from "../src/modules/payments/provider-earnings.policy";
import { ProviderEarningsService } from "../src/modules/payments/provider-earnings.service";

const legacyOrder = {
  pricingModel: "LEGACY_PACKAGE_V1" as const,
  subtotalCentavos: 50_000,
  platformFeeCentavos: 2_500,
  totalCentavos: 52_500,
  currency: "PHP",
};

test("earning policy uses immutable V2 subtotal and legacy payment net", () => {
  assert.deepEqual(
    providerEarningPrincipal(
      {
        ...legacyOrder,
        pricingModel: "SINGLE_PRICE_V2",
        subtotalCentavos: 70_000,
        platformFeeCentavos: 3_500,
        totalCentavos: 73_500,
      },
      {
        id: "payment-v2",
        amountCentavos: 73_500,
        platformFeeCentavos: 3_500,
        providerNetCentavos: 70_000,
        currency: "PHP",
      },
    ),
    { amountCentavos: 70_000, currency: "PHP" },
  );
  assert.deepEqual(
    providerEarningPrincipal(legacyOrder, {
      id: "payment-legacy",
      amountCentavos: 52_500,
      platformFeeCentavos: 2_500,
      providerNetCentavos: 49_000,
      currency: "PHP",
    }),
    { amountCentavos: 49_000, currency: "PHP" },
  );
  assert.throws(
    () =>
      providerEarningPrincipal(legacyOrder, {
        id: "payment-bad",
        amountCentavos: 52_499,
        platformFeeCentavos: 2_500,
        providerNetCentavos: 50_000,
        currency: "PHP",
      }),
    /snapshots do not match/,
  );
});

test("webhook and reconciliation race creates one pending earning credit", async () => {
  let paymentStatus = "REQUIRES_ACTION";
  const earningWrites: any[] = [];
  const payment = {
    id: "payment-1",
    orderId: "order-1",
    providerCheckoutId: "checkout-1",
    amountCentavos: 73_500,
    platformFeeCentavos: 3_500,
    providerNetCentavos: 70_000,
    currency: "PHP",
    paidAt: null as Date | null,
    createdAt: new Date(),
  };
  const order = {
    id: "order-1",
    clientId: "client-1",
    providerId: "provider-1",
    titleSnapshot: "Rush brand design",
    pricingModel: "SINGLE_PRICE_V2",
    subtotalCentavos: 70_000,
    platformFeeCentavos: 3_500,
    totalCentavos: 73_500,
    currency: "PHP",
    deliveryDurationMinutes: 360,
  };
  const database = {
    $queryRaw: async () => [{ locked: true }],
    orderDispute: { findFirst: async () => null },
    payment: {
      updateMany: async ({ data }: any) => {
        if (paymentStatus !== "REQUIRES_ACTION") return { count: 0 };
        paymentStatus = "PAID";
        payment.paidAt = data.paidAt;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ ...payment, order }),
    },
    providerEarning: {
      create: async ({ data }: any) => {
        earningWrites.push(data);
        return { id: "earning-1", ...data };
      },
    },
    order: { updateMany: async () => ({ count: 1 }) },
    notification: { createMany: async () => ({ count: 2 }) },
    paymentWebhookEvent: { update: async () => undefined },
  };
  let event = 0;
  const prisma = {
    order: {
      findFirst: async () => ({ id: order.id }),
      findUniqueOrThrow: async () => order,
    },
    payment: {
      findUnique: async () => ({ ...payment, status: paymentStatus }),
      findFirst: async () => ({ ...payment, status: paymentStatus }),
      findMany: async () => [{ ...payment, status: paymentStatus }],
    },
    orderRevisionPurchase: { findUnique: async () => null },
    paymentWebhookEvent: {
      create: async () => ({ id: `event-${++event}`, processedAt: null }),
      update: async () => undefined,
    },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };
  const paymongo = {
    paidCheckout: async () => ({
      id: "paymongo-payment-1",
      amountCentavos: 73_500,
      currency: "PHP",
      paidAt: new Date("2026-10-05T10:00:00Z"),
    }),
  };
  const service = new PaymentLedgerService(prisma as never, paymongo as never);
  const webhook = service.processWebhook({
    data: {
      id: "provider-event-1",
      type: "event",
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
                  amount: 73_500,
                  currency: "PHP",
                  paid_at: Math.floor(
                    Date.parse("2026-10-05T10:00:00Z") / 1000,
                  ),
                },
              },
            ],
          },
        },
      },
    },
  });
  const reconciliation = service.forOrder("client-1", order.id);
  await Promise.all([webhook, reconciliation]);

  assert.equal(paymentStatus, "PAID");
  assert.equal(earningWrites.length, 1);
  assert.equal(earningWrites[0].providerId, order.providerId);
  assert.equal(earningWrites[0].orderId, order.id);
  assert.equal(earningWrites[0].paymentId, payment.id);
  assert.equal(earningWrites[0].grossServiceAmountCentavos, 70_000);
  assert.equal(earningWrites[0].currency, "PHP");
  assert.equal(earningWrites[0].status, "PENDING");
  assert.deepEqual(earningWrites[0].ledgerEntries.create, {
    providerId: order.providerId,
    orderId: order.id,
    sourcePaymentId: payment.id,
    type: "EARNING_PENDING_CREDIT",
    amountCentavos: 70_000,
    currency: "PHP",
    sourceKey: pendingEarningCreditSourceKey(payment.id),
    createdAt: payment.paidAt,
  });
});

test("provider read model is isolated and rejects ledger inconsistency", async () => {
  const captured: any[] = [];
  const earning = {
    id: "earning-1",
    providerId: "provider-1",
    orderId: "order-1",
    currency: "PHP",
    grossServiceAmountCentavos: 50_000,
    status: "PENDING",
    pendingAt: new Date("2026-10-05T10:00:00Z"),
    availableAt: null as Date | null,
    createdAt: new Date("2026-10-05T10:00:00Z"),
    order: { orderNumber: "CG-1", titleSnapshot: "Logo design" },
    ledgerEntries: [
      {
        providerId: "provider-1",
        orderId: "order-1",
        type: "EARNING_PENDING_CREDIT",
        amountCentavos: 50_000,
        currency: "PHP",
        createdAt: new Date("2026-10-05T10:00:00Z"),
      },
    ],
    disputeAssociations: [],
    refunds: [],
    payoutItems: [],
  };
  const prisma = {
    providerEarningLedgerEntry: {
      groupBy: async (query: any) => {
        captured.push(query);
        return query.where.providerEarning.status === "PENDING"
          ? [{ currency: "PHP", _sum: { amountCentavos: 50_000 } }]
          : [];
      },
    },
    providerEarning: {
      findMany: async (query: any) => {
        captured.push(query);
        return [earning];
      },
    },
  };
  const service = new ProviderEarningsService(prisma as never);
  const summary = await service.summary("provider-1");
  const history = await service.list("provider-1");
  assert.equal(summary.data[0].pendingCentavos, 50_000);
  assert.equal(summary.data[0].availableCentavos, 0);
  assert.equal(history.data[0].amountCentavos, 50_000);
  assert.ok(
    captured.every(
      (query) =>
        query.where.providerId === "provider-1" ||
        query.where.providerId === undefined,
    ),
  );
  earning.ledgerEntries[0].amountCentavos = 49_999;
  await assert.rejects(
    service.list("provider-1"),
    InternalServerErrorException,
  );
});

test("Phase E migration is additive, deterministic, and excludes refunded history", () => {
  const root = resolve(import.meta.dirname, "../..");
  const migration = readFileSync(
    resolve(
      root,
      "api/prisma/migrations/20261005160000_add_provider_earnings_shadow_ledger/migration.sql",
    ),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "ProviderEarning"/);
  assert.match(migration, /CREATE TABLE "ProviderEarningLedgerEntry"/);
  assert.match(migration, /payment\."providerNetCentavos"/);
  assert.match(migration, /orders\."subtotalCentavos"/);
  assert.match(migration, /payment\."status" = 'PAID'/);
  assert.match(migration, /payment\."refundedCentavos" = 0/);
  assert.match(migration, /refund\."status" = 'SUCCEEDED'/);
  assert.match(migration, /payment\."paidAt" IS NOT NULL/);
  assert.match(migration, /'PENDING'::"ProviderEarningStatus"/);
  assert.match(migration, /partially refunded provider earnings/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|TYPE)|DELETE\s+FROM/i);
});

test("earnings read endpoints remain isolated from payout mutation paths", () => {
  const root = resolve(import.meta.dirname, "../..");
  const controller = readFileSync(
    resolve(root, "api/src/modules/payments/provider-earnings.controller.ts"),
    "utf8",
  );
  assert.match(controller, /@Roles\(UserRole\.PROVIDER\)/);
  assert.doesNotMatch(controller, /@Post|@Put|@Patch|@Delete/);
  assert.doesNotMatch(controller, /@Post|@Put|@Patch|@Delete/);
});
