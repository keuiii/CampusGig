import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const workspace = readFileSync(
  resolve(root, "app/features/orders/WebOrderWorkspace.tsx"),
  "utf8",
);
const admin = readFileSync(
  resolve(root, "app/features/admin/AdminDashboard.tsx"),
  "utf8",
);
const api = readFileSync(resolve(root, "app/lib/api.ts"), "utf8");
const types = readFileSync(resolve(root, "app/types.ts"), "utf8");

test("participant Web flow exposes deadlines, responses, immutable evidence, and frozen state", () => {
  assert.match(types, /"WAITING_FOR_CLIENT"/);
  assert.match(types, /"WAITING_FOR_PROVIDER"/);
  assert.match(types, /"READY_FOR_REVIEW"/);
  assert.match(types, /preFreezeStatus: "PENDING" \| "AVAILABLE"/);
  assert.match(api, /submitDisputeResponse/);
  assert.match(api, /addDisputeEvidence/);
  assert.match(api, /disputeEvidence/);
  assert.match(workspace, /Completion paused/);
  assert.match(workspace, /No refund has been issued/);
  assert.match(workspace, /respond by/);
  assert.match(workspace, /without replacing earlier files/);
  assert.match(
    workspace,
    /Downloading a file does not automatically accept the order/,
  );
});

test("admin Web flow supports every Phase H review action and status filter", () => {
  assert.match(admin, /Waiting for client/);
  assert.match(admin, /Waiting for provider/);
  assert.match(admin, /Ready for review/);
  assert.match(admin, /Request client/);
  assert.match(admin, /Request provider/);
  assert.match(admin, /Mark ready/);
  assert.match(admin, /Begin review/);
  assert.match(admin, /RESOLVED_CLIENT/);
  assert.match(admin, /RESOLVED_PROVIDER/);
  assert.match(admin, /access does not prove acceptance/);
  assert.match(api, /requestDisputeResponse/);
  assert.match(api, /markDisputeReady/);
});

test("Phase I preserves Phase H protections while excluding partial refunds and payouts", () => {
  assert.doesNotMatch(
    workspace,
    />\s*(Partial refund|Withdraw|Cash Out|Request payout)\s*</i,
  );
  assert.doesNotMatch(
    admin,
    />\s*(Partial refund|Payout|Withdrawal|Manual debit)\s*</i,
  );
});
