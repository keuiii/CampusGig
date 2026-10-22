import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

test("the web order workspace exposes the dispute workflow", () => {
  const web = readFileSync(
    resolve(root, "app/features/orders/WebOrderWorkspace.tsx"),
    "utf8",
  );
  assert.match(web, /orders\/.+\/disputes|openOrderDispute/);
  assert.match(web, /Report a problem/);
  assert.match(web, /Submit report/);
  assert.match(web, /resolutionNote/);
  assert.match(web, /submitDisputeResponse/);
  assert.match(web, /responseDeadlineAt/);
  assert.match(web, /No refund has been issued/);
});

test("administrator dashboard exposes review and final resolution actions", () => {
  const admin = readFileSync(
    resolve(root, "app/features/admin/AdminDashboard.tsx"),
    "utf8",
  );
  assert.match(admin, /beginDisputeReview/);
  assert.match(admin, /RESOLVED_CLIENT/);
  assert.match(admin, /RESOLVED_PROVIDER/);
  assert.match(admin, /Dispute review queue/);
  assert.match(admin, /Request client/);
  assert.match(admin, /Request provider/);
  assert.match(admin, /Mark ready/);
});

test("administrator overview keeps responsive priority and management hierarchy", () => {
  const admin = readFileSync(
    resolve(root, "app/features/admin/AdminDashboard.tsx"),
    "utf8",
  );
  const styles = readFileSync(resolve(root, "app/globals.css"), "utf8");

  assert.match(admin, /admin-overview-header/);
  assert.match(admin, /admin-summary-bar/);
  assert.match(admin, /admin-command-bar/);
  assert.match(admin, /admin-action-grid/);
  assert.match(admin, /admin-school-drawer/);
  assert.match(admin, /requestAnimationFrame\(updateActiveSection\)/);
  assert.match(admin, /data-active=\{activeAdminSection\}/);
  assert.match(admin, /if \(atPageEnd\) current = "schools"/);
  assert.match(admin, /Exit admin/);
  assert.match(admin, /<Icon name="exit" \/>/);
  assert.match(admin, /aria-label="Exit admin"/);
  assert.match(admin, /admin-select-control/);
  assert.match(admin, /SCHOOL_PAGE_SIZE = 5/);
  assert.match(admin, /visibleSchools\.map/);
  assert.match(admin, /admin-school-pagination/);
  assert.match(admin, /admin-school-title-actions/);
  assert.match(admin, /aria-modal="true"/);
  assert.match(admin, /Priority review queues/);
  assert.match(admin, /Access and school management/);
  assert.match(styles, /\.admin-overview-page/);
  assert.match(styles, /\.admin-command-bar/);
  assert.match(styles, /\.admin-dashboard-shell\s*\{\s*display: block/);
  assert.match(styles, /top: 50%/);
  assert.match(styles, /transform: translateY\(-50%\)/);
  assert.match(styles, /background: transparent/);
  assert.match(styles, /translateY\(76px\)/);
  assert.match(styles, /width: max-content/);
  assert.match(styles, /grid-template-rows: repeat\(3, 34px\)/);
  assert.match(styles, /height: 118px/);
  assert.match(styles, /\.admin-school-pagination/);
  assert.doesNotMatch(
    styles,
    /\.admin-app-shell > \.topbar\s*\{[^}]*display:\s*none/,
  );
  assert.match(styles, /\.admin-drawer-backdrop/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
