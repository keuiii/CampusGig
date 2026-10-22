import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const workspace = readFileSync(
  resolve(root, "app/features/orders/WebOrderWorkspace.tsx"),
  "utf8",
);
const api = readFileSync(resolve(root, "app/lib/api.ts"), "utf8");
const types = readFileSync(resolve(root, "app/types.ts"), "utf8");
const dashboard = readFileSync(
  resolve(root, "app/features/provider/ProviderDashboard.tsx"),
  "utf8",
);

test("Web models and API expose typed correction, included, and paid-extra revision contracts", () => {
  assert.match(
    types,
    /"PROVIDER_CORRECTION" \| "INCLUDED" \| "PAID_EXTRA" \| null/,
  );
  assert.match(types, /export type ExtraRevisionQuote/);
  assert.match(types, /providerSubtotalCentavos: number/);
  assert.match(types, /platformFeeCentavos: number/);
  assert.match(types, /turnaroundMinutes: number/);
  assert.match(types, /activationStatus:/);
  assert.match(api, /payments\/revision-quote/);
  assert.match(api, /payments\/revision-checkout/);
  assert.match(api, /revisions\/correction-claim/);
  assert.match(api, /correction-decision/);
});

test("client workspace distinguishes included, acknowledged correction, extra purchase, and scope change", () => {
  assert.match(workspace, /active\.revisionLimit - active\.revisionsUsed/);
  assert.match(workspace, /Request Included Revision/);
  assert.match(workspace, /Ask Provider to Acknowledge Correction/);
  assert.match(workspace, /does not bypass revision limits automatically/i);
  assert.match(workspace, /Purchase Extra Revision/);
  assert.match(workspace, /extraRevisionQuote\.providerSubtotalCentavos/);
  assert.match(workspace, /extraRevisionQuote\.platformFeeCentavos/);
  assert.match(workspace, /extraRevisionQuote\.clientTotalCentavos/);
  assert.match(workspace, /extraRevisionQuote\.turnaroundMinutes/);
  assert.match(workspace, /Payment is optional and activates only after/);
  assert.match(workspace, /campusgig\.revisionPaymentReturnOrderId/);
  assert.match(workspace, /Need something outside the original requirements/);
  assert.match(workspace, /Create a new order for additional work/);
});

test("provider workspace shows revision type, deadline, decisions, and paid-extra earning identity", () => {
  assert.match(workspace, /Provider deadline:/);
  assert.match(workspace, /Acknowledge correction/);
  assert.match(workspace, /Decline .* client may dispute/);
  assert.match(workspace, /Extra earning:/);
  assert.match(dashboard, /Paid extra revision/);
  assert.match(dashboard, /Original order earning/);
});

test("Phase G Web UI keeps revision purchase behavior separate from payout actions", () => {
  assert.match(workspace, /Report a problem/);
  assert.match(workspace, /stale checkout could\s+not activate/);
  assert.doesNotMatch(workspace, />\s*(Partial refund|Withdraw|Cash Out|Request payout)\s*</i);
  assert.doesNotMatch(
    dashboard,
    />\s*(Withdraw|Cash Out|Request payout)\s*</i,
  );
  assert.doesNotMatch(
    workspace,
    /createExtraRevisionCheckout[\s\S]{0,500}setPaymentVerificationPending\(true\)/,
  );
});
