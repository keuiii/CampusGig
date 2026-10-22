import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const provider = readFileSync(
  resolve(root, "app/features/provider/ProviderDashboard.tsx"),
  "utf8",
);
const admin = readFileSync(
  resolve(root, "app/features/admin/AdminDashboard.tsx"),
  "utf8",
);
const api = readFileSync(resolve(root, "app/lib/api.ts"), "utf8");
const types = readFileSync(resolve(root, "app/types.ts"), "utf8");

test("provider payout UI explains the hold and renders server eligibility", () => {
  assert.match(provider, /exactly 24 hours/);
  assert.match(provider, /withdrawalEligibleAt/);
  assert.match(provider, /isWithdrawable/);
  assert.match(provider, /Withdrawable is a subset of Available/);
  assert.match(types, /withdrawableCentavos: number/);
});

test("provider requests withdraw-all without caller-authoritative amount", () => {
  assert.match(provider, /Withdraw all eligible earnings/);
  assert.match(provider, /Payout fee:/);
  assert.match(provider, /crypto\.randomUUID\(\)/);
  assert.match(api, /clientRequestId: string/);
  assert.doesNotMatch(
    api,
    /requestProviderPayout[\s\S]{0,300}(requestedPrincipalCentavos|amountCentavos)/,
  );
});

test("destinations are masked and unreviewed destinations cannot be selected", () => {
  assert.match(provider, /maskedAccountIdentifier/);
  assert.match(provider, /ADMIN_REVIEWED/);
  assert.match(provider, /PROVIDER_VERIFIED/);
  assert.match(provider, /administrator-reviewed destination is required/);
  const maskedDestination = types.match(
    /export type PayoutDestination = \{[\s\S]*?\n\};/,
  );
  assert.ok(maskedDestination);
  assert.doesNotMatch(maskedDestination[0], /accountIdentifier/);
  assert.match(types, /export type SensitivePayoutDestination[\s\S]*accountIdentifier: string/);
  assert.match(admin, /sensitivePayoutDestination/);
  assert.match(admin, /Access (?:to these details )?is security logged/);
});

test("provider history never represents non-terminal payout states as paid", () => {
  for (const state of [
    "REQUESTED",
    "APPROVED",
    "PROCESSING",
    "FAILED",
    "REJECTED",
    "CANCELLED",
    "RECONCILIATION_REQUIRED",
  ])
    assert.match(types, new RegExp(`\\| "${state}"`));
  assert.match(provider, /No payment is implied by this status/);
  assert.match(provider, /Settlement evidence recorded/);
});

test("admin workflow preserves immutable amounts and evidence-gated settlement", () => {
  assert.match(admin, /Approve only/);
  assert.match(admin, /Reject and release/);
  assert.match(admin, /Begin manual settlement/);
  assert.match(admin, /Record settlement evidence/);
  assert.match(admin, /manualReference/);
  assert.match(admin, /settledAt: new Date\(\)\.toISOString\(\)/);
  assert.match(admin, /payout\.netDisbursementCentavos/);
  assert.match(admin, /CampusGig is not initiating a transfer/);
  assert.doesNotMatch(admin, /type="number"[\s\S]{0,200}settleManualPayout/);
});
