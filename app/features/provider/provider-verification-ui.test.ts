import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("completed verified profiles replace readiness progress with a badge", async () => {
  const dashboard = await readFile(
    "app/features/provider/ProviderDashboard.tsx",
    "utf8",
  );

  assert.match(
    dashboard,
    /stats\.verified === true && stats\.profileStrength >= 100/,
  );
  assert.match(dashboard, /className="provider-verified-stamp"/);
  assert.match(dashboard, /!isFullyVerifiedProvider \? \(/);
  assert.match(dashboard, /className="readiness-track"/);
});
