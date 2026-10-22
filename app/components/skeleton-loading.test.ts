import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isInitialContentLoad } from "./Skeletons";

test("initial skeletons never replace retained content during refresh", () => {
  assert.equal(isInitialContentLoad(true, 0), true);
  assert.equal(isInitialContentLoad(true, 3), false);
  assert.equal(isInitialContentLoad(false, 0), false);
});

test("shared skeletons are accessible, themed, and reduced-motion safe", async () => {
  const [component, styles] = await Promise.all([
    readFile("app/components/Skeletons.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);

  assert.match(component, /role="status"/);
  assert.match(component, /aria-label=\{label\}/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(styles, /--skeleton-base:/);
  assert.match(styles, /html\[data-theme="dark"\]/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.skeleton-block\s*\{[\s\S]*animation: none/);
});

test("order messages use skeletons only until their initial detail arrives", async () => {
  const workspace = await readFile(
    "app/features/orders/WebOrderWorkspace.tsx",
    "utf8",
  );

  assert.match(workspace, /!detail \? \([\s\S]*kind="conversation"/);
  assert.match(workspace, /label="Loading order timeline"/);
  assert.doesNotMatch(workspace, /Loading timeline…/);
});
