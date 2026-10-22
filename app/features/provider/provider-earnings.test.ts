import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const dashboard = readFileSync(
  resolve(root, "app/features/provider/ProviderDashboard.tsx"),
  "utf8",
);
const api = readFileSync(resolve(root, "app/lib/api.ts"), "utf8");
const types = readFileSync(resolve(root, "app/types.ts"), "utf8");

test("provider dashboard renders truthful currency-separated earnings", () => {
  assert.match(types, /export type ProviderEarningsSummary/);
  assert.match(types, /export type ProviderEarning/);
  assert.match(dashboard, />Provider Earnings and Payouts</);
  for (const bucket of [
    "Pending",
    "Available",
    "Withdrawable",
    "Frozen",
    "Payout Processing",
    "Paid Out",
    "Refunded",
  ])
    assert.match(dashboard, new RegExp(`\\["${bucket}"`));
  assert.match(
    dashboard,
    /formatEarningAmount\(summary\[field\], summary\.currency\)/,
  );
  assert.match(dashboard, /No paid-order earnings have been recorded yet/);
  assert.match(dashboard, /exactly 24 hours/);
  assert.match(dashboard, /Paid extra revision/);
  assert.match(dashboard, /Original order earning/);
});

test("Web payout controls keep amounts server-authoritative and destinations masked", () => {
  assert.match(api, /"\/provider\/earnings\/summary"/);
  assert.match(api, /`\/provider\/earnings\?limit=20/);
  assert.match(api, /"\/provider\/payouts\/destinations"/);
  assert.match(api, /"\/provider\/payouts"/);
  assert.match(dashboard, /Withdraw all eligible earnings/);
  assert.match(dashboard, /Payout fee:.*0/);
  assert.match(dashboard, /maskedAccountIdentifier/);
  assert.match(dashboard, /No payment is implied by this status/);
  assert.doesNotMatch(api, /requestProviderPayout[\s\S]{0,260}amountCentavos/);
});
