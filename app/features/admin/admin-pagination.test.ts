import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin queues expose cursor continuation controls", async () => {
  const [dashboard, schoolDashboard, apiClient] = await Promise.all([
    readFile("app/features/admin/AdminDashboard.tsx", "utf8"),
    readFile("app/features/admin/SchoolAdminDashboard.tsx", "utf8"),
    readFile("app/lib/api.ts", "utf8"),
  ]);

  for (const queue of [
    "verifications",
    "services",
    "disputes",
    "school-admins",
  ])
    assert.match(apiClient, new RegExp(`/admin/${queue}\\?limit=20`));
  assert.match(dashboard, /loadMoreQueue/);
  assert.match(dashboard, /Load more verifications/);
  assert.match(dashboard, /Load more services/);
  assert.match(dashboard, /Load more disputes/);
  assert.match(dashboard, /Load more administrators/);
  assert.match(schoolDashboard, /Load more verifications/);
});

test("admin workspace keeps restrained desktop and responsive proportions", async () => {
  const [styles, dashboard] = await Promise.all([
    readFile("app/globals.css", "utf8"),
    readFile("app/features/admin/AdminDashboard.tsx", "utf8"),
  ]);

  assert.match(styles, /max-width:\s*1320px/);
  assert.match(
    styles,
    /\.admin-action-grid \{[\s\S]*?grid-template-columns:\s*1fr/,
  );
  assert.match(
    styles,
    /\.admin-action-grid \.admin-panel \{[\s\S]*?grid-template-columns:\s*260px minmax\(0, 1fr\)/,
  );
  assert.match(
    styles,
    /grid-template-columns:\s*minmax\(310px, 5fr\) minmax\(0, 8fr\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 980px\)[\s\S]*?\.admin-overview-page \.admin-school-grid \{\s*grid-template-columns:\s*1fr/,
  );
  assert.match(dashboard, /className="admin-dispute-dialog"/);
  assert.match(dashboard, /aria-modal="true"/);
  assert.doesNotMatch(dashboard, /selectedDispute\?\.id === item\.id/);
});
