import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const sourceFiles = [
  "app/catalog.ts",
  "app/globals.css",
  "app/features/marketplace/MarketplaceViews.tsx",
  "app/features/provider/ProviderAccessGuide.tsx",
  "mobile/src/catalog.ts",
  "mobile/src/screens/Profile.tsx",
  "api/prisma/seed.ts",
];

test("the Gemini-like sparkle icon is absent from CampusGig UI sources", () => {
  for (const relativePath of sourceFiles) {
    const contents = readFileSync(
      resolve(process.cwd(), "..", relativePath),
      "utf8",
    );
    assert.doesNotMatch(contents, /[✦✧]/u, relativePath);
  }
});
