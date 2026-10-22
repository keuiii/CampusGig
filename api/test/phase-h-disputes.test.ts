import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { DisputeDeadlineReconciler } from "../src/modules/disputes/dispute-deadline-reconciler.service";

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const service = readFileSync(
  resolve(root, "src/modules/disputes/disputes.service.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(
    root,
    "prisma/migrations/20261007120000_add_dispute_evidence_response_freeze/migration.sql",
  ),
  "utf8",
);

test("schema stores targets, response context, immutable evidence, and pre-freeze provenance", () => {
  assert.match(schema, /WAITING_FOR_CLIENT/);
  assert.match(schema, /WAITING_FOR_PROVIDER/);
  assert.match(schema, /READY_FOR_REVIEW/);
  assert.match(schema, /model DisputeAffectedEarning/);
  assert.match(schema, /preFreezeStatus\s+ProviderEarningStatus/);
  assert.match(schema, /model DisputeResponse/);
  assert.match(schema, /model DisputeEvidence/);
  assert.match(schema, /targetDeliverySubmissionId/);
  assert.match(schema, /targetRevisionPurchaseId/);
  assert.match(schema, /EARNING_FROZEN/);
  assert.match(schema, /EARNING_UNFROZEN/);
});

test("migration is additive for history and enforces one active dispute", () => {
  assert.match(migration, /Historical disputes remain unchanged/);
  assert.match(migration, /OrderDispute_one_active_per_order/);
  assert.match(migration, /WHERE "status" IN/);
  assert.match(migration, /DisputeAffectedEarning_pre_freeze_status/);
  assert.match(migration, /"amountCentavos" = 0/);
  assert.doesNotMatch(migration, /UPDATE "OrderDispute"/);
  assert.doesNotMatch(migration, /PaymentRefund/);
});

test("resolution restores provenance only for provider or dismissal and never creates refund accounting", () => {
  assert.match(service, /affected\.preFreezeStatus/);
  assert.match(service, /EARNING_UNFROZEN/);
  assert.match(service, /status === DisputeStatus\.RESOLVED_PROVIDER/);
  assert.match(service, /status === DisputeStatus\.CLOSED/);
  assert.match(service, /status === DisputeStatus\.RESOLVED_CLIENT/);
  assert.match(service, /remains frozen; no refund has been issued yet/);
  assert.doesNotMatch(service, /paymentRefund\.(create|update|upsert)/);
  assert.doesNotMatch(service, /amountCentavos:\s*-/);
});

test("deadline reconciler bounds work, isolates failures, and prevents overlap", async () => {
  let releaseFirst!: () => void;
  const first = new Promise<void>((resolvePromise) => {
    releaseFirst = resolvePromise;
  });
  let calls = 0;
  const disputes = {
    expiredResponseDisputeIds: async (_now: Date, limit: number) => {
      assert.equal(limit, 2);
      return ["first", "second"];
    },
    reconcileExpiredResponse: async (id: string) => {
      calls += 1;
      if (id === "first") await first;
      if (id === "second") throw new Error("isolated failure");
      return { transitioned: true };
    },
  };
  const config = {
    get: (key: string) =>
      key === "DISPUTE_DEADLINE_BATCH_SIZE" ? "2" : "false",
  };
  const reconciler = new DisputeDeadlineReconciler(
    disputes as never,
    config as never,
  );
  const running = reconciler.runOnce(new Date());
  assert.deepEqual(await reconciler.runOnce(new Date()), {
    examined: 0,
    readied: 0,
    failed: 0,
  });
  releaseFirst();
  assert.deepEqual(await running, { examined: 2, readied: 1, failed: 1 });
  assert.equal(calls, 2);
});

test("service serializes dispute transitions and never auto-selects a winner", () => {
  assert.match(service, /lockOrderReview\(database, orderId\)/);
  assert.match(service, /RESPONSE_DEADLINE_EXPIRED/);
  assert.match(service, /status: "READY_FOR_REVIEW"/);
  assert.doesNotMatch(
    service,
    /RESPONSE_DEADLINE_EXPIRED[\s\S]{0,600}RESOLVED_(CLIENT|PROVIDER)/,
  );
});
