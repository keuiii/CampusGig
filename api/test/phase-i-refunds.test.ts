import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  PaymongoClient,
  PaymongoRefundError,
} from "../src/modules/payments/paymongo.client";

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    root,
    "prisma/migrations/20261008030000_add_full_refunds_reversal_accounting/migration.sql",
  ),
  "utf8",
);
const service = readFileSync(
  resolve(root, "src/modules/payments/refunds.service.ts"),
  "utf8",
);
const paymongo = readFileSync(
  resolve(root, "src/modules/payments/paymongo.client.ts"),
  "utf8",
);
const orders = readFileSync(
  resolve(root, "src/modules/orders/orders.service.ts"),
  "utf8",
);

function client() {
  return new PaymongoClient({
    get: (key: string) =>
      key === "PAYMONGO_SECRET_KEY" ? "sk_test_refund_fixture" : undefined,
  } as never);
}

test("Phase I remains migration 40 with exact refund snapshots after later phases", () => {
  assert.equal(
    readdirSync(resolve(root, "prisma/migrations"), {
      withFileTypes: true,
    }).filter((entry) => entry.isDirectory()).length,
    41,
  );
  assert.match(schema, /enum RefundStatus \{[\s\S]*REQUESTED[\s\S]*PROCESSING[\s\S]*RECONCILIATION_REQUIRED/);
  assert.match(schema, /providerPrincipalCentavos\s+Int\?/);
  assert.match(schema, /platformFeeCentavos\s+Int\?/);
  assert.match(schema, /refundTotalCentavos\s+Int\?/);
  assert.match(schema, /triggeringDisputeId\s+String\?/);
  assert.match(schema, /preRefundEarningStatus\s+ProviderEarningStatus\?/);
  assert.match(migration, /Historical refund rows remain valid/);
  assert.match(migration, /"refundTotalCentavos" = "providerPrincipalCentavos" \+ "platformFeeCentavos"/);
  assert.match(migration, /"amountCentavos" = "refundTotalCentavos"/);
});

test("accounting persists independent principal and CampusGig fee reversals exactly once", () => {
  assert.match(schema, /EARNING_REFUND_REVERSAL/);
  assert.match(schema, /model PlatformFeeLedgerEntry/);
  assert.match(migration, /"amountCentavos" < 0/);
  assert.match(migration, /PlatformFeeLedgerEntry_refundId_key/);
  assert.match(service, /amountCentavos: -snapshot\.providerPrincipalCentavos!/);
  assert.match(service, /amountCentavos: -snapshot\.platformFeeCentavos!/);
  assert.match(service, /status: ProviderEarningStatus\.REFUNDED/);
  assert.match(service, /status: PaymentStatus\.REFUNDED/);
});

test("eligibility and race guards cover not-started and missed-rush full refunds", () => {
  assert.match(service, /PAID_NOT_STARTED/);
  assert.match(service, /MISSED_RUSH_DEADLINE/);
  assert.match(service, /deliveryOption === "NORMAL"/);
  assert.match(service, /deliverySubmissions\.length > 0/);
  assert.match(service, /await lockOrderReview\(database, input\.orderId\)/);
  assert.match(orders, /async start[\s\S]*await lockOrderReview\(database, order\.id\)/);
  assert.match(service, /status: PaymentStatus\.REFUND_PENDING/);
  assert.ok(
    service.indexOf("const existing = await database.paymentRefund.findFirst") <
      service.indexOf("const target = await this.resolveTarget"),
    "an idempotent retry must resolve the existing refund before requiring a PAID source",
  );
  assert.match(
    service,
    /await lockOrderReview\(database, locator\.orderId\);[\s\S]*const snapshot = await database\.paymentRefund\.findUnique/,
  );
});

test("dispute and stale revision refunds bind to one exact economic source", () => {
  assert.match(service, /status !== "RESOLVED_CLIENT"/);
  assert.match(service, /targetRevisionPurchaseId/);
  assert.match(service, /STALE_REVISION_PAYMENT/);
  assert.match(service, /activationStatus !== "RECONCILIATION_REQUIRED"/);
  assert.match(service, /revisionPendingEarningCreditSourceKey/);
  assert.match(service, /activationStatus: "REFUNDED"/);
});

test("PayMongo refund creation sends full centavo amount and idempotency key", async () => {
  const previousFetch = globalThis.fetch;
  let url = "";
  let request: RequestInit | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input);
    request = init;
    return new Response(
      JSON.stringify({
        data: {
          id: "ref_test",
          attributes: {
            amount: 11200,
            currency: "PHP",
            payment_id: "pay_test",
            reason: "others",
            status: "pending",
            created_at: 1791417600,
            updated_at: 1791417600,
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const refund = await client().createRefund({
      amountCentavos: 11200,
      paymentId: "pay_test",
      idempotencyKey: "refund-idempotency-test",
      notes: "CampusGig full refund",
    });
    const body = JSON.parse(String(request?.body));
    assert.equal(url, "https://api.paymongo.com/v1/refunds");
    assert.equal(body.data.attributes.amount, 11200);
    assert.equal(body.data.attributes.payment_id, "pay_test");
    assert.equal(body.data.attributes.reason, "others");
    assert.equal(
      (request?.headers as Record<string, string>)["Idempotency-Key"],
      "refund-idempotency-test",
    );
    assert.equal(refund.status, "pending");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("ambiguous provider transport outcomes require reconciliation and never imply success", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("network reset");
  }) as typeof fetch;
  try {
    await assert.rejects(
      client().createRefund({
        amountCentavos: 11200,
        paymentId: "pay_test",
        idempotencyKey: "refund-idempotency-test",
        notes: "CampusGig full refund",
      }),
      (error: unknown) =>
        error instanceof PaymongoRefundError && error.outcome === "UNKNOWN",
    );
    assert.match(service, /RefundStatus\.RECONCILIATION_REQUIRED/);
    assert.match(service, /Do not retry creation/);
    assert.match(paymongo, /retrieveRefund/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Phase I contains no payout implementation or ordinary partial-refund path", () => {
  assert.doesNotMatch(service, /PARTIALLY_REFUNDED/);
  assert.doesNotMatch(service, /createPayout|withdrawal|cash.?out/i);
  assert.match(service, /PAYOUT_PROCESSING/);
  assert.match(service, /cannot be refunded without payout-aware recovery/);
});
