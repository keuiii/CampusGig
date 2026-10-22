import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("every web account profile exposes a validated persisted support form", async () => {
  const [profile, panel, api] = await Promise.all([
    readFile("app/features/account/WebAccountProfile.tsx", "utf8"),
    readFile("app/features/account/SupportPanel.tsx", "utf8"),
    readFile("app/lib/api.ts", "utf8"),
  ]);

  assert.match(profile, /<SupportPanel token=\{token\} notify=\{notify\}/);
  assert.match(panel, /minLength=\{20\}/);
  assert.match(panel, /source: "WEB"/);
  assert.match(panel, /result\.reference/);
  assert.match(api, /"\/support\/tickets"/);
});
