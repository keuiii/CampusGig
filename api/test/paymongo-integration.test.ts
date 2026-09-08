import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { PaymongoClient } from "../src/modules/payments/paymongo.client";
import { PaymentLedgerService } from "../src/modules/payments/payment-ledger.service";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function client(values: Record<string, string>) {
  return new PaymongoClient({ get: (key: string) => values[key] } as never);
}

test("PayMongo webhook signatures are verified against the untouched raw body", () => {
  const webhookSecret = "whsk_test_secure_fixture";
  const rawBody = Buffer.from('{"data":{"id":"evt_test"}}');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");

  assert.doesNotThrow(() =>
    client({ PAYMONGO_WEBHOOK_SECRET: webhookSecret }).verifyWebhook(
      rawBody,
      `t=${timestamp},te=${signature}`,
    ),
  );
});

test("PayMongo webhook verification rejects a modified body", () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  assert.throws(
    () =>
      client({ PAYMONGO_WEBHOOK_SECRET: "whsk_test_secure_fixture" }).verifyWebhook(
        Buffer.from("modified"),
        `t=${timestamp},te=${"0".repeat(64)}`,
      ),
    UnauthorizedException,
  );
});

test("checkout creation keeps the secret server-side and sends integer PHP amounts", async () => {
  const previousFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    request = init;
    return new Response(JSON.stringify({
      data: { id: "cs_test", attributes: { checkout_url: "https://checkout.paymongo.com/test" } },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await client({
      PAYMONGO_SECRET_KEY: "sk_test_private_fixture",
      WEB_ORIGIN: "http://localhost:3000",
    }).createCheckout({
      amountCentavos: 250000,
      orderNumber: "CG-2026-TEST",
      title: "Logo Design",
      customerName: "Campus Student",
      customerEmail: "student@example.com",
    });
    const body = JSON.parse(String(request?.body));
    assert.equal(body.data.attributes.line_items[0].amount, 250000);
    assert.equal(body.data.attributes.line_items[0].currency, "PHP");
    assert.match(String((request?.headers as Record<string, string>).Authorization), /^Basic /);
    assert.equal(result.id, "cs_test");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("a paid checkout updates the ledger and notifications in one transaction", async () => {
  let notificationCount = 0;
  let paymentStatus = "REQUIRES_ACTION";
  let eventProcessed = false;
  const database = {
    payment: {
      updateMany: async () => { paymentStatus = "PAID"; return { count: 1 }; },
    },
    notification: {
      createMany: async ({ data }: { data: unknown[] }) => { notificationCount = data.length; },
    },
    paymentWebhookEvent: {
      update: async () => { eventProcessed = true; },
    },
  };
  const prisma = {
    paymentWebhookEvent: {
      create: async () => ({ id: "event-1", processedAt: null }),
      update: async () => undefined,
    },
    payment: {
      findUnique: async () => ({ id: "payment-1", orderId: "order-1", amountCentavos: 250000 }),
    },
    order: {
      findUniqueOrThrow: async () => ({ clientId: "client-1", providerId: "provider-1", titleSnapshot: "Logo Design" }),
    },
    $transaction: async (operation: (client: typeof database) => unknown) => operation(database),
  };
  const service = new PaymentLedgerService(prisma as never, {} as never);
  const result = await service.processWebhook({
    data: {
      id: "evt_paid",
      type: "event",
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: false,
        data: {
          id: "cs_test",
          type: "checkout_session",
          attributes: { payments: [{ id: "pay_test", attributes: { amount: 250000 } }] },
        },
      },
    },
  });
  assert.equal(paymentStatus, "PAID");
  assert.equal(notificationCount, 2);
  assert.equal(eventProcessed, true);
  assert.equal(result.received, true);
});

test("web and mobile expose PayMongo checkout without embedding secret keys", () => {
  const root = resolve(import.meta.dirname, "../..");
  const sources = [
    readFileSync(resolve(root, "app/features/orders/WebOrderWorkspace.tsx"), "utf8"),
    readFileSync(resolve(root, "mobile/src/features/orders/OrderWorkspaceModal.tsx"), "utf8"),
  ];
  for (const source of sources) {
    assert.match(source, /Proceed to payment/);
    assert.doesNotMatch(source, /sk_test_|PAYMONGO_SECRET_KEY/);
  }
});
