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

test("Web renders current and historical immutable delivery versions", () => {
  assert.match(types, /export type DeliverySubmission/);
  assert.match(types, /deliverySubmissions\?: DeliverySubmission\[\]/);
  assert.match(workspace, /Delivery history/);
  assert.match(workspace, /Version \{submission\.version\}/);
  assert.match(workspace, /submission\.isCurrent/);
  assert.match(workspace, /submission\.files\.map/);
  assert.match(workspace, /No delivery note was recorded/);
  assert.doesNotMatch(workspace, /editDeliverySubmission|replaceDeliveryFile/);
});

test("Web submits an idempotency key and keeps access separate from acceptance", () => {
  assert.match(api, /form\.append\("clientRequestId", clientRequestId\)/);
  assert.match(workspace, /globalThis\.crypto\.randomUUID\(\)/);
  assert.match(
    workspace,
    /Downloading a file does not automatically accept the order\./,
  );
  assert.match(workspace, /api\.orderFile\(token, order\.id, fileId\)/);
  assert.doesNotMatch(
    workspace,
    /downloadFile[\s\S]{0,500}(completeOrder|requestOrderRevision)/,
  );
});

test("Web retains a filtered legacy delivery fallback", () => {
  assert.match(workspace, /Legacy delivery files/);
  assert.match(workspace, /\["DELIVERABLE", "REVISION"\]/);
});
