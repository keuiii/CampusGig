import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import {
  PaymongoCheckoutError,
  PaymongoClient,
} from "../src/modules/payments/paymongo.client";
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
      client({
        PAYMONGO_WEBHOOK_SECRET: "whsk_test_secure_fixture",
      }).verifyWebhook(
        Buffer.from("modified"),
        `t=${timestamp},te=${"0".repeat(64)}`,
      ),
    UnauthorizedException,
  );
});

test("PayMongo live webhooks verify the live signature field only", () => {
  const webhookSecret = "whsk_live_secure_fixture";
  const rawBody = Buffer.from(
    '{"data":{"id":"evt_live","type":"event","attributes":{"livemode":true}}}',
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  const liveClient = client({
    NODE_ENV: "production",
    PAYMONGO_MODE: "live",
    PAYMONGO_WEBHOOK_SECRET: webhookSecret,
  });

  assert.doesNotThrow(() =>
    liveClient.verifyWebhook(rawBody, `t=${timestamp},te=,li=${signature}`),
  );
  assert.throws(
    () =>
      liveClient.verifyWebhook(rawBody, `t=${timestamp},te=${signature},li=`),
    UnauthorizedException,
  );
});

test("checkout creation keeps the secret server-side and sends integer PHP amounts", async () => {
  const previousFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    request = init;
    return new Response(
      JSON.stringify({
        data: {
          id: "cs_test",
          attributes: { checkout_url: "https://checkout.paymongo.com/test" },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const result = await client({
      PAYMONGO_SECRET_KEY: "sk_test_private_fixture",
      WEB_ORIGIN: "http://localhost:3000",
    }).createCheckout({
      amountCentavos: 250000,
      orderId: "order-1",
      orderNumber: "CG-2026-TEST",
      title: "Logo Design",
      customerName: "Campus Student",
      customerEmail: "student@example.com",
    });
    const body = JSON.parse(String(request?.body));
    assert.equal(body.data.attributes.line_items[0].amount, 250000);
    assert.equal(body.data.attributes.line_items[0].currency, "PHP");
    assert.match(body.data.attributes.success_url, /orderId=order-1/);
    assert.match(
      String((request?.headers as Record<string, string>).Authorization),
      /^Basic /,
    );
    assert.equal(result.id, "cs_test");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("live checkout requires an explicit production live configuration", async () => {
  const previousFetch = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    authorization = String(
      (init?.headers as Record<string, string> | undefined)?.Authorization,
    );
    return new Response(
      JSON.stringify({
        data: {
          id: "cs_live",
          attributes: { checkout_url: "https://checkout.paymongo.com/live" },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  const input = {
    amountCentavos: 10000,
    orderId: "order-live",
    orderNumber: "CG-2026-LIVE",
    title: "Live service",
    customerName: "Campus Student",
    customerEmail: "student@example.com",
  };
  try {
    await client({
      NODE_ENV: "production",
      PAYMONGO_MODE: "live",
      PAYMONGO_SECRET_KEY: "sk_live_private_fixture",
      WEB_ORIGIN: "https://campusgig.example",
    }).createCheckout(input);
    assert.equal(
      Buffer.from(authorization.slice("Basic ".length), "base64").toString(),
      "sk_live_private_fixture:",
    );
    await assert.rejects(
      () =>
        client({
          NODE_ENV: "development",
          PAYMONGO_MODE: "live",
          PAYMONGO_SECRET_KEY: "sk_live_private_fixture",
          WEB_ORIGIN: "https://campusgig.example",
        }).createCheckout(input),
      /requires the production environment/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("mobile checkout returns through an emulator-accessible app-link bridge", async () => {
  const previousFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    request = init;
    return new Response(
      JSON.stringify({
        data: {
          id: "cs_mobile",
          attributes: { checkout_url: "https://checkout.paymongo.com/mobile" },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    await client({
      PAYMONGO_SECRET_KEY: "sk_test_private_fixture",
    }).createCheckout({
      amountCentavos: 250000,
      orderId: "order-mobile",
      orderNumber: "CG-MOBILE",
      title: "Logo Design",
      customerName: "Mobile Client",
      customerEmail: "mobile@example.com",
      returnTarget: "MOBILE",
    });
    const body = JSON.parse(String(request?.body));
    const successUrl = new URL(body.data.attributes.success_url);
    assert.equal(successUrl.hostname, "10.0.2.2");
    assert.equal(successUrl.searchParams.get("paymentTarget"), "mobile");
    assert.equal(successUrl.searchParams.get("orderId"), "order-mobile");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("mobile checkout uses the requesting API as its private LAN app-link bridge", async () => {
  const previousFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    request = init;
    return new Response(
      JSON.stringify({
        data: {
          id: "cs_physical",
          attributes: {
            checkout_url: "https://checkout.paymongo.com/physical",
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    await client({
      PAYMONGO_SECRET_KEY: "sk_test_private_fixture",
      PAYMONGO_MOBILE_RETURN_ORIGIN: "http://localhost:3000",
      PAYMONGO_MOBILE_SUCCESS_URL: "http://localhost:3000/payment/complete",
      PAYMONGO_MOBILE_CANCEL_URL: "http://localhost:3000/payment/cancelled",
    }).createCheckout({
      amountCentavos: 81585,
      orderId: "order-physical",
      orderNumber: "CG-PHYSICAL",
      title: "Fixed-price service",
      customerName: "Mobile Client",
      customerEmail: "mobile@example.com",
      returnTarget: "MOBILE",
      requestOrigin: "http://192.168.1.25:4000",
    });
    const body = JSON.parse(String(request?.body));
    const successUrl = new URL(body.data.attributes.success_url);
    assert.equal(successUrl.hostname, "192.168.1.25");
    assert.equal(successUrl.port, "4000");
    assert.equal(successUrl.pathname, "/api/v1/payments/mobile-return");
    assert.equal(successUrl.searchParams.get("paymentTarget"), "mobile");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("an authenticated order refresh reconciles a paid checkout when its webhook was delayed", async () => {
  let paymentStatus = "REQUIRES_ACTION";
  let notificationCount = 0;
  let earningCount = 0;
  let realtimeStatus = "";
  const payment = {
    id: "payment-1",
    orderId: "order-1",
    status: paymentStatus,
    providerCheckoutId: "cs_paid",
    amountCentavos: 250000,
    currency: "PHP",
    createdAt: new Date(),
  };
  const database = {
    payment: {
      updateMany: async () => {
        if (paymentStatus === "PAID") return { count: 0 };
        paymentStatus = "PAID";
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        id: payment.id,
        amountCentavos: payment.amountCentavos,
        platformFeeCentavos: 0,
        providerNetCentavos: payment.amountCentavos,
        currency: payment.currency,
        paidAt: new Date(),
        order: {
          id: payment.orderId,
          providerId: "provider-1",
          pricingModel: "LEGACY_PACKAGE_V1",
          subtotalCentavos: payment.amountCentavos,
          platformFeeCentavos: 0,
          totalCentavos: payment.amountCentavos,
          currency: payment.currency,
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
    notification: {
      createMany: async ({ data }: { data: unknown[] }) => {
        notificationCount += data.length;
      },
    },
    paymentWebhookEvent: { update: async () => undefined },
    $queryRaw: async () => [{ locked: true }],
  };
  const prisma = {
    order: {
      findFirst: async () => ({ id: "order-1" }),
      findUniqueOrThrow: async () => ({
        clientId: "client-1",
        providerId: "provider-1",
        titleSnapshot: "Logo Design",
      }),
    },
    payment: {
      findFirst: async () => ({ ...payment, status: paymentStatus }),
      findMany: async () => [{ ...payment, status: paymentStatus }],
    },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };
  const paymongo = {
    paidCheckout: async () => ({
      id: "pay_verified",
      amountCentavos: 250000,
      currency: "PHP",
      paidAt: new Date("2026-10-08T08:00:00.000Z"),
    }),
  };
  const realtime = {
    publishPaymentChanged: (
      _orderId: string,
      _participants: string[],
      status: string,
    ) => {
      realtimeStatus = status;
    },
  };

  const result = await new PaymentLedgerService(
    prisma as never,
    paymongo as never,
    realtime as never,
  ).forOrder("client-1", "order-1");

  assert.equal(result.data[0].status, "PAID");
  assert.equal(notificationCount, 2);
  assert.equal(earningCount, 1);
  assert.equal(realtimeStatus, "PAID");
});

test("network uncertainty is distinguished from a definitive checkout rejection", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      throw new TypeError("connection reset after request write");
    }) as typeof fetch;
    await assert.rejects(
      () =>
        client({
          PAYMONGO_SECRET_KEY: "sk_test_private_fixture",
        }).createCheckout({
          amountCentavos: 250000,
          orderId: "order-1",
          orderNumber: "CG-TEST",
          title: "Logo Design",
          customerName: "Client",
          customerEmail: "client@example.com",
        }),
      (error) =>
        error instanceof PaymongoCheckoutError && error.outcome === "UNKNOWN",
    );

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ errors: [{ detail: "Invalid request" }] }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof fetch;
    await assert.rejects(
      () =>
        client({
          PAYMONGO_SECRET_KEY: "sk_test_private_fixture",
        }).createCheckout({
          amountCentavos: 250000,
          orderId: "order-1",
          orderNumber: "CG-TEST",
          title: "Logo Design",
          customerName: "Client",
          customerEmail: "client@example.com",
        }),
      (error) =>
        error instanceof PaymongoCheckoutError && error.outcome === "REJECTED",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("checkout is blocked until the provider accepts the request", async () => {
  const prisma = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        clientId: "client-1",
        status: "REQUESTED",
        orderNumber: "CG-TEST",
        titleSnapshot: "Logo Design",
        client: { displayName: "Client", email: "client@example.com" },
      }),
    },
  };
  const service = new PaymentLedgerService(prisma as never, {} as never);
  await assert.rejects(
    () => service.createCheckout("client-1", "order-1"),
    /Payment is available after the provider accepts/,
  );
});

test("legacy active unpaid orders can open checkout and recover safely", async () => {
  const statuses = [
    "IN_PROGRESS",
    "REVISION_REQUESTED",
    "SUBMITTED",
    "COMPLETED",
  ];

  for (const status of statuses) {
    const prisma = {
      order: {
        findUnique: async () => ({
          id: "order-1",
          clientId: "client-1",
          status,
          orderNumber: "CG-TEST",
          titleSnapshot: "Logo Design",
          client: { displayName: "Client", email: "client@example.com" },
        }),
      },
      payment: {
        findFirst: async () => ({
          id: "payment-1",
          status: "REQUIRES_ACTION",
          checkoutUrl: "https://checkout.paymongo.com/recovery",
        }),
      },
    };

    const result = await new PaymentLedgerService(
      prisma as never,
      {} as never,
    ).createCheckout("client-1", "order-1");
    assert.equal(result.checkoutUrl, "https://checkout.paymongo.com/recovery");
  }
});

test("concurrent checkout creation reuses the database-guarded active payment", async () => {
  const active = {
    id: "payment-active",
    orderId: "order-1",
    status: "PENDING",
  };
  const prisma = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        subtotalCentavos: 50000,
        platformFeeCentavos: 3500,
        totalCentavos: 53500,
        currency: "PHP",
      }),
    },
    payment: {
      upsert: async () => {
        throw { code: "P2002" };
      },
      findFirst: async () => active,
    },
  };
  const result = await new PaymentLedgerService(
    prisma as never,
    {} as never,
  ).createPending("order-1", "checkout:race");
  assert.equal(result.id, "payment-active");
});

test("concurrent checkout requests create only one external PayMongo session", async () => {
  const payment = {
    id: "payment-active",
    orderId: "order-1",
    amountCentavos: 53500,
    currency: "PHP",
    status: "PENDING",
    checkoutUrl: null as string | null,
    createdAt: new Date(),
  };
  let claimed = false;
  let checkoutCalls = 0;
  const prisma = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        clientId: "client-1",
        status: "ACCEPTED",
        orderNumber: "CG-TEST",
        titleSnapshot: "Logo Design",
        client: { displayName: "Client", email: "client@example.com" },
      }),
    },
    payment: {
      findFirst: async () => payment,
      findUnique: async () => payment,
      updateMany: async () => {
        if (claimed) return { count: 0 };
        claimed = true;
        payment.status = "REQUIRES_ACTION";
        return { count: 1 };
      },
      update: async ({ data }: { data: { checkoutUrl: string } }) => {
        payment.checkoutUrl = data.checkoutUrl;
        return payment;
      },
    },
  };
  const paymongo = {
    createCheckout: async () => {
      checkoutCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        id: "cs_test",
        attributes: { checkout_url: "https://checkout.paymongo.com/test" },
      };
    },
  };
  const service = new PaymentLedgerService(prisma as never, paymongo as never);
  const [first, second] = await Promise.all([
    service.createCheckout("client-1", "order-1"),
    service.createCheckout("client-1", "order-1"),
  ]);
  assert.equal(checkoutCalls, 1);
  assert.equal(first.checkoutUrl, second.checkoutUrl);
});

test("an ambiguous checkout failure remains locked against a second charge", async () => {
  const payment = {
    id: "payment-unknown",
    amountCentavos: 53500,
    currency: "PHP",
    status: "PENDING",
    checkoutUrl: null,
    failureCode: null as string | null,
    createdAt: new Date(),
  };
  let findCount = 0;
  const updates: Record<string, unknown>[] = [];
  const prisma = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        clientId: "client-1",
        status: "ACCEPTED",
        orderNumber: "CG-TEST",
        titleSnapshot: "Logo Design",
        client: { displayName: "Client", email: "client@example.com" },
      }),
    },
    payment: {
      findFirst: async () => (++findCount === 1 ? null : payment),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        Object.assign(payment, data);
        return { count: 1 };
      },
    },
  };
  const paymongo = {
    createCheckout: async () => {
      throw new PaymongoCheckoutError("Connection lost", "UNKNOWN");
    },
  };
  const service = new PaymentLedgerService(prisma as never, paymongo as never);
  await assert.rejects(
    () => service.createCheckout("client-1", "order-1"),
    /Connection lost/,
  );
  assert.deepEqual(updates.at(-1), {
    failureCode: "checkout_creation_unknown",
  });
  await assert.rejects(
    () => service.createCheckout("client-1", "order-1"),
    /previous checkout attempt is still being verified/i,
  );
});

test("a refunded order cannot create a replacement full-price checkout", async () => {
  let paymongoCalls = 0;
  const prisma = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        clientId: "client-1",
        status: "COMPLETED",
        orderNumber: "CG-TEST",
        titleSnapshot: "Logo Design",
        client: { displayName: "Client", email: "client@example.com" },
      }),
    },
    payment: {
      findFirst: async () => ({
        id: "payment-refunded",
        status: "PARTIALLY_REFUNDED",
        createdAt: new Date(),
      }),
    },
  };
  const service = new PaymentLedgerService(
    prisma as never,
    {
      createCheckout: async () => {
        paymongoCalls += 1;
      },
    } as never,
  );
  await assert.rejects(
    () => service.createCheckout("client-1", "order-1"),
    /already been paid and refunded/i,
  );
  assert.equal(paymongoCalls, 0);
});

test("refund webhooks delegate authoritative evidence to Phase I accounting", async () => {
  let refundAmount = 0;
  const prisma = {
    paymentWebhookEvent: {
      create: async () => ({ id: "event-refund", processedAt: null }),
      update: async () => undefined,
    },
  };
  const refunds = {
    applyWebhookRefund: async (input: { amountCentavos: number }) => {
      refundAmount = input.amountCentavos;
    },
  };
  await new PaymentLedgerService(
    prisma as never,
    {} as never,
    undefined,
    refunds as never,
  ).processWebhook({
    data: {
      id: "evt_refund",
      type: "event",
      attributes: {
        type: "payment.refunded",
        livemode: false,
        data: {
          id: "pay_test",
          type: "payment",
          attributes: {
            refunds: [
              {
                id: "ref_test",
                attributes: {
                  amount: 50000,
                  status: "succeeded",
                  reason: "requested_by_customer",
                },
              },
            ],
          },
        },
      },
    },
  });
  assert.equal(refundAmount, 50000);
});

test("refund webhooks reject empty provider evidence", async () => {
  const prisma = {
    paymentWebhookEvent: {
      create: async () => ({ id: "event-empty-refund", processedAt: null }),
      update: async () => undefined,
    },
  };
  await assert.rejects(
    () =>
      new PaymentLedgerService(prisma as never, {} as never, undefined, {
        applyWebhookRefund: async () => undefined,
      } as never).processWebhook({
        data: {
          id: "evt_empty_refund",
          type: "event",
          attributes: {
            type: "payment.refunded",
            livemode: false,
            data: {
              id: "pay_test",
              type: "payment",
              attributes: { refunds: [] },
            },
          },
        },
      }),
    /provider evidence is missing/,
  );
});

test("a paid checkout updates the ledger and notifications in one transaction", async () => {
  let notificationCount = 0;
  let paymentStatus = "REQUIRES_ACTION";
  let eventProcessed = false;
  let earningCount = 0;
  const database = {
    payment: {
      updateMany: async () => {
        paymentStatus = "PAID";
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        id: "payment-1",
        amountCentavos: 250000,
        platformFeeCentavos: 0,
        providerNetCentavos: 250000,
        currency: "PHP",
        paidAt: new Date(),
        order: {
          id: "order-1",
          providerId: "provider-1",
          pricingModel: "LEGACY_PACKAGE_V1",
          subtotalCentavos: 250000,
          platformFeeCentavos: 0,
          totalCentavos: 250000,
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
    notification: {
      createMany: async ({ data }: { data: unknown[] }) => {
        notificationCount = data.length;
      },
    },
    paymentWebhookEvent: {
      update: async () => {
        eventProcessed = true;
      },
    },
    $queryRaw: async () => [{ locked: true }],
  };
  const prisma = {
    paymentWebhookEvent: {
      create: async () => ({ id: "event-1", processedAt: null }),
      update: async () => undefined,
    },
    payment: {
      findUnique: async () => ({
        id: "payment-1",
        orderId: "order-1",
        amountCentavos: 250000,
        currency: "PHP",
      }),
    },
    orderRevisionPurchase: { findUnique: async () => null },
    order: {
      findUniqueOrThrow: async () => ({
        clientId: "client-1",
        providerId: "provider-1",
        titleSnapshot: "Logo Design",
      }),
    },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };
  const service = new PaymentLedgerService(
    prisma as never,
    {} as never,
    undefined,
    undefined,
    {
      get: (key: string) => (key === "PAYMONGO_MODE" ? "live" : undefined),
    } as never,
  );
  const result = await service.processWebhook({
    data: {
      id: "evt_paid",
      type: "event",
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: true,
        data: {
          id: "cs_test",
          type: "checkout_session",
          attributes: {
            payments: [
              {
                id: "pay_test",
                attributes: {
                  amount: 250000,
                  currency: "PHP",
                  paid_at: 1_759_910_400,
                },
              },
            ],
          },
        },
      },
    },
  });
  assert.equal(paymentStatus, "PAID");
  assert.equal(notificationCount, 2);
  assert.equal(earningCount, 1);
  assert.equal(eventProcessed, true);
  assert.equal(result.received, true);
});

test("paid webhooks require provider identity, exact amount, and currency", async () => {
  const prisma = {
    paymentWebhookEvent: {
      create: async () => ({ id: "event-invalid", processedAt: null }),
      update: async () => undefined,
    },
    payment: {
      findUnique: async () => ({
        id: "payment-1",
        orderId: "order-1",
        amountCentavos: 250000,
        currency: "PHP",
      }),
    },
    orderRevisionPurchase: { findUnique: async () => null },
  };
  const service = new PaymentLedgerService(prisma as never, {} as never);
  const payload = (payments: unknown[]) => ({
    data: {
      id: `evt_${payments.length}_${JSON.stringify(payments).length}`,
      type: "event" as const,
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: false,
        data: {
          id: "cs_test",
          type: "checkout_session",
          attributes: { payments },
        },
      },
    },
  });
  await assert.rejects(
    () =>
      service.processWebhook(
        payload([{ attributes: { amount: 250000 } }]) as never,
      ),
    /missing its payment ID/,
  );
  await assert.rejects(
    () => service.processWebhook(payload([{ id: "pay_test" }]) as never),
    /invalid payment amount/,
  );
  await assert.rejects(
    () =>
      service.processWebhook(
        payload([{ id: "pay_test", attributes: { amount: 250000 } }]) as never,
      ),
    /currency does not match/,
  );
  await assert.rejects(
    () =>
      service.processWebhook(
        payload([
          {
            id: "pay_test",
            attributes: { amount: 250000, currency: "PHP" },
          },
        ]) as never,
      ),
    /authoritative payment timestamp/,
  );
  await assert.rejects(
    () =>
      service.processWebhook(
        payload([
          {
            id: "pay_test",
            attributes: { amount: 250000, currency: "USD" },
          },
        ]) as never,
      ),
    /currency does not match/,
  );
});

test("a delayed paid webhook cannot revert a refunded payment", async () => {
  let notificationCount = 0;
  let realtimeCount = 0;
  let transitionFilter: unknown;
  const database = {
    $queryRaw: async () => [{ locked: true }],
    orderDispute: { findFirst: async () => null },
    payment: {
      updateMany: async ({ where }: { where: unknown }) => {
        transitionFilter = where;
        return { count: 0 };
      },
    },
    notification: {
      createMany: async () => {
        notificationCount += 1;
      },
    },
    paymentWebhookEvent: { update: async () => undefined },
  };
  const prisma = {
    paymentWebhookEvent: {
      create: async () => ({ id: "event-delayed", processedAt: null }),
      update: async () => undefined,
    },
    payment: {
      findUnique: async () => ({
        id: "payment-1",
        orderId: "order-1",
        amountCentavos: 250000,
        currency: "PHP",
        status: "REFUNDED",
      }),
    },
    orderRevisionPurchase: { findUnique: async () => null },
    order: {
      findUniqueOrThrow: async () => ({
        clientId: "client-1",
        providerId: "provider-1",
        titleSnapshot: "Logo Design",
      }),
    },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };
  await new PaymentLedgerService(
    prisma as never,
    {} as never,
    {
      publishPaymentChanged: () => {
        realtimeCount += 1;
      },
    } as never,
  ).processWebhook({
    data: {
      id: "evt_delayed_paid",
      type: "event",
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: false,
        data: {
          id: "cs_test",
          type: "checkout_session",
          attributes: {
            payments: [
              {
                id: "pay_test",
                attributes: {
                  amount: 250000,
                  currency: "PHP",
                  paid_at: 1_759_910_400,
                },
              },
            ],
          },
        },
      },
    },
  });
  assert.deepEqual(transitionFilter, {
    id: "payment-1",
    status: { in: ["PENDING", "REQUIRES_ACTION"] },
  });
  assert.equal(notificationCount, 0);
  assert.equal(realtimeCount, 0);
});

test("web exposes PayMongo checkout without embedding secret keys", () => {
  const root = resolve(import.meta.dirname, "../..");
  const rootPackage = readFileSync(resolve(root, "package.json"), "utf8");
  const source = readFileSync(
    resolve(root, "app/features/orders/WebOrderWorkspace.tsx"),
    "utf8",
  );
  assert.match(source, /Proceed to payment/);
  assert.doesNotMatch(source, /sk_test_|PAYMONGO_SECRET_KEY/);
  assert.match(source, /payment-checkout-button/);
  assert.match(source, /report-problem-button/);
  assert.match(source, /<Icon name="card"/);
  assert.match(source, /<Icon name="flag"/);
  assert.match(source, /campusgig\.paymentReturnOrderId/);
  assert.match(source, /paymentVerificationPending/);
  assert.match(source, /Check payment status/);
  assert.match(rootPackage, /"dev": "next dev --port 3000"/);
  assert.match(rootPackage, /"start": "next start --port 3000"/);
});

test("MAUI order workspace opens PayMongo checkout without embedding secret keys", () => {
  const root = resolve(import.meta.dirname, "../..");
  const workspace = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/Pages/OrderWorkspacePage.xaml.cs"),
    "utf8",
  );
  const layout = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/Pages/OrderWorkspacePage.xaml"),
    "utf8",
  );
  assert.match(workspace, /orders\/\{orderId\}\/payments\/checkout/);
  assert.match(workspace, /returnTarget = "MOBILE"/);
  assert.match(workspace, /Browser\.Default\.OpenAsync/);
  assert.match(workspace, /Uri\.UriSchemeHttps/);
  assert.match(layout, /Proceed to payment/);
  assert.match(layout, /PaymentCheckButton/);
  assert.match(workspace, /campusgig_pending_payment_order/);
  assert.match(workspace, /PaymentReturnRules\.IsAwaitingConfirmation/);
  assert.match(workspace, /detail\?\.PaymentStatus != "PAID"/);
  assert.match(workspace, /canAccessFiles/);
  const app = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/App.xaml.cs"),
    "utf8",
  );
  assert.match(app, /RestorePendingPaymentAsync/);
  assert.match(app, /OpenClientOrderAsync/);
  assert.match(app, /OnAppLinkRequestReceived/);
  const activity = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/Platforms/Android/MainActivity.cs"),
    "utf8",
  );
  const project = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/CampusGig.Mobile.csproj"),
    "utf8",
  );
  const discover = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/Pages/HomePage.xaml"),
    "utf8",
  );
  assert.match(activity, /DataScheme = "campusgig"/);
  assert.match(project, /-d reverse tcp:3000 tcp:3000/);
  assert.match(project, /-d reverse tcp:4000 tcp:4000/);
  assert.match(project, /-e reverse tcp:3000 tcp:3000/);
  assert.match(project, /-e reverse tcp:4000 tcp:4000/);
  assert.match(
    project,
    /MauiImage Include="Resources\\Images\\campusgig_mark\.svg"/,
  );
  assert.doesNotMatch(project, /MauiImage Include="Resources\\Images\\\*"/);
  assert.match(discover, /CollectionView x:Name="ServiceCards"/);
  assert.match(discover, /<CollectionView\.ItemTemplate>/);
  assert.doesNotMatch(discover, /<ScrollView>|BindableLayout\.ItemsSource/);
  assert.doesNotMatch(
    `${workspace}\n${layout}`,
    /sk_test_|PAYMONGO_SECRET_KEY/,
  );
});

test("web marketplace creates a persisted order before opening payment", () => {
  const root = resolve(import.meta.dirname, "../..");
  const apiClient = readFileSync(resolve(root, "app/lib/api.ts"), "utf8");
  const marketplace = readFileSync(
    resolve(root, "app/features/marketplace/MarketplaceViews.tsx"),
    "utf8",
  );
  const app = readFileSync(resolve(root, "app/page.tsx"), "utf8");
  const styles = readFileSync(resolve(root, "app/globals.css"), "utf8");

  assert.match(apiClient, /createOrder:[\s\S]*"\/orders"[\s\S]*method: "POST"/);
  assert.match(marketplace, /Project requirements/);
  assert.match(marketplace, /servicePackageId/);
  assert.match(marketplace, /requirementsLength < 10/);
  assert.match(marketplace, /item\.tier\.charAt\(0\)/);
  assert.match(marketplace, /aria-label="Service packages"/);
  assert.match(marketplace, /setConfirming\(true\)/);
  assert.match(marketplace, /Confirm and send/);
  assert.match(marketplace, /role="dialog"/);
  assert.match(app, /api\.createOrder/);
  assert.match(app, /setNotificationOrderId\(result\.data\.id\)/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /\.tier-tabs::after/);
  assert.match(styles, /\.request-confirm-dialog/);
  assert.match(styles, /\.package-details > p/);
  assert.match(styles, /word-break: break-word/);
  assert.match(styles, /\.web-booking-actions \.secondary-button/);
  assert.match(styles, /html\[data-theme="dark"\] \.web-booking-actions/);
  assert.doesNotMatch(marketplace, /Connect order creation to continue/);
});

test("web order views import icons and paginate client and provider lists", () => {
  const root = resolve(import.meta.dirname, "../..");
  const workspace = readFileSync(
    resolve(root, "app/features/orders/WebOrderWorkspace.tsx"),
    "utf8",
  );
  const orders = readFileSync(
    resolve(root, "app/features/orders/OrdersView.tsx"),
    "utf8",
  );
  const providerDashboard = readFileSync(
    resolve(root, "app/features/provider/ProviderDashboard.tsx"),
    "utf8",
  );
  const styles = readFileSync(resolve(root, "app/globals.css"), "utf8");

  assert.match(
    workspace,
    /import \{ Icon \} from "\.\.\/\.\.\/components\/brand"/,
  );
  assert.match(orders, /const ordersPerPage = 6/);
  assert.match(orders, /visibleOrders\.slice/);
  assert.match(orders, /aria-current=.*"page"/);
  assert.match(orders, /Previous orders page/);
  assert.match(orders, /Next orders page/);
  assert.match(providerDashboard, /const providerRequestsPerPage = 5/);
  assert.match(providerDashboard, /providerOrders\.slice/);
  assert.match(providerDashboard, /Client service request pages/);
  assert.match(providerDashboard, /Previous service requests page/);
  assert.match(providerDashboard, /Next service requests page/);
  assert.match(providerDashboard, /aria-current=/);
  assert.match(workspace, /className="workspace-timeline"/);
  assert.match(workspace, /paymentConfirmed &&/);
  assert.match(workspace, /canAccessFiles/);
  assert.match(providerDashboard, /Awaiting client payment/);
  assert.match(styles, /\.workspace-timeline \{\s*order: 1/);
  assert.match(styles, /\.workspace-dispute \{\s*order: 2/);
});
