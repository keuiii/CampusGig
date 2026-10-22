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

test("Web client uses server-authoritative full-refund eligibility and status", () => {
  assert.match(api, /refundEligibility/);
  assert.match(api, /requestFullRefund/);
  assert.match(types, /type RefundEligibility/);
  assert.match(types, /RECONCILIATION_REQUIRED/);
  assert.match(workspace, /including the CampusGig service fee/);
  assert.match(workspace, /Request full rush refund/);
  assert.match(workspace, /CampusGig will not mark it complete until PayMongo confirms success/);
});
test("admin refund queue supports dispute, stale revision, and reconciliation paths", () => {
  assert.match(admin, /Issue exact full refund/);
  assert.match(admin, /Refund stale payment/);
  assert.match(admin, /Reconcile with PayMongo/);
  assert.match(admin, /Provider principal/);
  assert.match(admin, /CampusGig fee/);
  assert.match(api, /refundFromDispute/);
  assert.match(api, /refundStaleRevision/);
  assert.match(api, /reconcileRefund/);
});

test("Phase I Web surfaces no ordinary partial refund or payout action", () => {
  assert.doesNotMatch(workspace, />\s*(Partial refund|Withdraw|Cash Out|Request payout)\s*</i);
  assert.doesNotMatch(admin, />\s*(Partial refund|Withdraw|Cash Out|Request payout)\s*</i);
});
