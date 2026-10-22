import assert from "node:assert/strict";
import test from "node:test";
import { formatMarketplaceStatus } from "./marketplace-presentation";

test("marketplace statuses use consistent human-readable labels", () => {
  assert.equal(formatMarketplaceStatus("REQUIRES_ACTION"), "Awaiting payment");
  assert.equal(formatMarketplaceStatus("RECONCILIATION_REQUIRED"), "Needs review");
  assert.equal(formatMarketplaceStatus("REVISION_REQUESTED"), "Revision requested");
  assert.equal(formatMarketplaceStatus("IN_PROGRESS"), "In Progress");
  assert.equal(formatMarketplaceStatus(null), "Not available");
});
