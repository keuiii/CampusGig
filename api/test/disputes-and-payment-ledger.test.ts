import assert from "node:assert/strict";
import test from "node:test";
import {
  DisputeReason,
  DisputeResponseParty,
  DisputeStatus,
} from "@prisma/client";
import {
  affectedEarningForTarget,
  canOpenAfterExplicitAcceptance,
  remainingReviewSeconds,
  responseDeadline,
  resumedReviewDeadline,
  waitingStatus,
} from "../src/modules/disputes/dispute-policy";
import {
  ACTIVE_DISPUTE_STATUSES,
  isActiveDisputeStatus,
} from "../src/modules/disputes/dispute-status";
import { PaymentLedgerService } from "../src/modules/payments/payment-ledger.service";

test("Phase H defines every unresolved dispute state as active", () => {
  assert.deepEqual(ACTIVE_DISPUTE_STATUSES, [
    "OPEN",
    "WAITING_FOR_CLIENT",
    "WAITING_FOR_PROVIDER",
    "READY_FOR_REVIEW",
    "UNDER_REVIEW",
  ]);
  assert.equal(isActiveDisputeStatus(DisputeStatus.RESOLVED_CLIENT), false);
  assert.equal(isActiveDisputeStatus(DisputeStatus.RESOLVED_PROVIDER), false);
  assert.equal(isActiveDisputeStatus(DisputeStatus.CLOSED), false);
});

test("response requests persist an exact 48-hour window and matching wait state", () => {
  const requestedAt = new Date("2026-10-07T00:00:00.000Z");
  assert.equal(
    responseDeadline(requestedAt).toISOString(),
    "2026-10-09T00:00:00.000Z",
  );
  assert.equal(
    waitingStatus(DisputeResponseParty.CLIENT),
    DisputeStatus.WAITING_FOR_CLIENT,
  );
  assert.equal(
    waitingStatus(DisputeResponseParty.PROVIDER),
    DisputeStatus.WAITING_FOR_PROVIDER,
  );
});

test("paid revision targeting selects only the explicitly associated earning", () => {
  const earnings = [
    { id: "original", sourceType: "ORIGINAL_ORDER", revisionPurchaseId: null },
    {
      id: "revision-1",
      sourceType: "PAID_EXTRA_REVISION",
      revisionPurchaseId: "purchase-1",
    },
    {
      id: "revision-2",
      sourceType: "PAID_EXTRA_REVISION",
      revisionPurchaseId: "purchase-2",
    },
  ];
  assert.equal(affectedEarningForTarget(earnings, null)?.id, "original");
  assert.equal(
    affectedEarningForTarget(earnings, "purchase-2")?.id,
    "revision-2",
  );
  assert.equal(affectedEarningForTarget(earnings, "missing"), undefined);
});

test("provider resolution resumes exactly the remaining review duration", () => {
  const pausedAt = new Date("2026-10-07T10:00:00.000Z");
  const oldDeadline = new Date("2026-10-07T11:00:01.000Z");
  const remaining = remainingReviewSeconds(oldDeadline, pausedAt);
  assert.equal(remaining, 3_601);
  assert.equal(
    resumedReviewDeadline(
      new Date("2026-10-10T00:00:00.000Z"),
      remaining,
    ).toISOString(),
    "2026-10-10T01:00:01.000Z",
  );
});

test("explicit acceptance permits only payment and conduct escalations", () => {
  assert.equal(
    canOpenAfterExplicitAcceptance(DisputeReason.PAYMENT_ISSUE),
    true,
  );
  assert.equal(canOpenAfterExplicitAcceptance(DisputeReason.CONDUCT), true);
  assert.equal(
    canOpenAfterExplicitAcceptance(DisputeReason.QUALITY_ISSUE),
    false,
  );
  assert.equal(canOpenAfterExplicitAcceptance(DisputeReason.OTHER), false);
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
