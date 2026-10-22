import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

test("web actions use the CampusGig dialog instead of browser-native prompts", () => {
  const files = sourceFiles(resolve(root, "app"));
  const nativeDialogPattern = /window\.(?:alert|confirm|prompt)\s*\(/;

  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, "utf8"), nativeDialogPattern, file);
  }
});

test("the shared dialog provides accessible focus and validation behavior", () => {
  const dialog = readFileSync(
    resolve(root, "app/components/app-dialog.tsx"),
    "utf8",
  );
  const styles = readFileSync(resolve(root, "app/globals.css"), "utf8");

  assert.match(dialog, /role="alertdialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /promptValue\.trim\(\)\.length >= minimumLength/);
  assert.match(styles, /\.app-dialog-backdrop/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
