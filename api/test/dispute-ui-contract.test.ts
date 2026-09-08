import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

test("web and mobile order workspaces expose the dispute workflow", () => {
  const web = readFileSync(resolve(root, "app/features/orders/WebOrderWorkspace.tsx"), "utf8");
  const mobile = readFileSync(resolve(root, "mobile/src/features/orders/OrderWorkspaceModal.tsx"), "utf8");
  for (const source of [web, mobile]) {
    assert.match(source, /orders\/.+\/disputes|openOrderDispute/);
    assert.match(source, /Report a problem/);
    assert.match(source, /Submit report/);
    assert.match(source, /resolutionNote/);
  }
});

test("administrator dashboard exposes review and final resolution actions", () => {
  const admin = readFileSync(resolve(root, "app/features/admin/AdminDashboard.tsx"), "utf8");
  assert.match(admin, /beginDisputeReview/);
  assert.match(admin, /RESOLVED_CLIENT/);
  assert.match(admin, /RESOLVED_PROVIDER/);
  assert.match(admin, /Dispute review queue/);
});
