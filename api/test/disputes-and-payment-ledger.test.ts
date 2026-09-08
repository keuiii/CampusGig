import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { DisputesService } from "../src/modules/disputes/disputes.service";
import { PaymentLedgerService } from "../src/modules/payments/payment-ledger.service";

function participantOrder(status = "IN_PROGRESS") {
  return {
    id: "order-1",
    clientId: "client-1",
    providerId: "provider-1",
    status,
    titleSnapshot: "Logo Design",
  };
}

test("an order participant opens one dispute and notifies the counterparty atomically", async () => {
  let disputeInput: any;
  let notificationInput: any;
  const created = {
    id: "dispute-1",
    orderId: "order-1",
    status: "OPEN",
  };
  const database = {
    orderDispute: {
      create: async (input: unknown) => {
        disputeInput = input;
        return created;
      },
    },
    notification: {
      create: async (input: unknown) => (notificationInput = input),
    },
  };
  const prisma = {
    order: { findFirst: async () => participantOrder() },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };

  const result = await new DisputesService(prisma as never).open(
    "client-1",
    "order-1",
    "QUALITY_ISSUE",
    "The submitted work does not match the agreed requirements.",
  );

  assert.equal(disputeInput.data.openedById, "client-1");
  assert.equal(disputeInput.data.reason, "QUALITY_ISSUE");
  assert.equal(notificationInput.data.recipientId, "provider-1");
  assert.equal(notificationInput.data.type, "ORDER_DISPUTE_OPENED");
  assert.equal(result.data.status, "OPEN");
});

test("a dispute cannot be opened before the provider accepts the request", async () => {
  const prisma = {
    order: { findFirst: async () => participantOrder("REQUESTED") },
  };
  await assert.rejects(
    () =>
      new DisputesService(prisma as never).open(
        "client-1",
        "order-1",
        "OTHER",
        "There is a problem with this request.",
      ),
    ConflictException,
  );
});

test("users outside an order cannot read its dispute", async () => {
  const prisma = { order: { findFirst: async () => null } };
  await assert.rejects(
    () => new DisputesService(prisma as never).forOrder("outsider", "order-1"),
    NotFoundException,
  );
});

test("administrator resolution is conditional and notifies both participants", async () => {
  let updateInput: any;
  let notificationsInput: any;
  const dispute = {
    id: "dispute-1",
    orderId: "order-1",
    status: "UNDER_REVIEW",
    order: { clientId: "client-1", providerId: "provider-1" },
  };
  const database = {
    orderDispute: {
      updateMany: async (input: unknown) => {
        updateInput = input;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        ...dispute,
        status: "RESOLVED_CLIENT",
      }),
    },
    notification: {
      createMany: async (input: unknown) => (notificationsInput = input),
    },
  };
  const prisma = {
    orderDispute: { findUnique: async () => dispute },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };

  const result = await new DisputesService(prisma as never).resolve(
    "admin-1",
    "dispute-1",
    "RESOLVED_CLIENT",
    "The evidence supports a refund to the client.",
  );

  assert.equal(updateInput.data.resolvedById, "admin-1");
  assert.equal(updateInput.data.status, "RESOLVED_CLIENT");
  assert.deepEqual(
    notificationsInput.data.map((item: { recipientId: string }) => item.recipientId),
    ["client-1", "provider-1"],
  );
  assert.equal(result.data.status, "RESOLVED_CLIENT");
});

test("pending payment snapshots preserve the order total and fee", async () => {
  let upsertInput: any;
  const prisma = {
    order: {
      findUnique: async () => ({
        id: "order-1",
        subtotalCentavos: 9_000,
        totalCentavos: 10_000,
        platformFeeCentavos: 1_000,
        currency: "PHP",
      }),
    },
    payment: {
      upsert: async (input: unknown) => {
        upsertInput = input;
        return input;
      },
    },
  };

  await new PaymentLedgerService(prisma as never).createPending(
    "order-1",
    "checkout:order-1:1",
  );

  assert.equal(upsertInput.create.amountCentavos, 10_000);
  assert.equal(upsertInput.create.platformFeeCentavos, 1_000);
  assert.equal(upsertInput.create.providerNetCentavos, 9_000);
  assert.equal(upsertInput.create.currency, "PHP");
});

test("duplicate payment webhooks are identified instead of reprocessed", async () => {
  const existing = { id: "event-1", providerEventId: "evt_1" };
  const prisma = {
    paymentWebhookEvent: {
      create: async () => {
        throw { code: "P2002" };
      },
      findUniqueOrThrow: async () => existing,
    },
  };

  const result = await new PaymentLedgerService(
    prisma as never,
  ).recordWebhookOnce("evt_1", "payment.paid", { data: "safe-test" });

  assert.equal(result.duplicate, true);
  assert.equal(result.event.id, "event-1");
});
