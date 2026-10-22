import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const sourceFiles = [
  "app/catalog.ts",
  "app/globals.css",
  "app/features/marketplace/MarketplaceViews.tsx",
  "app/features/provider/ProviderAccessGuide.tsx",
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

test("web and mobile light themes use washed neutral page surfaces", () => {
  const webStyles = readFileSync(
    resolve(process.cwd(), "..", "app/globals.css"),
    "utf8",
  );

  assert.match(webStyles, /--page:\s*#f3f5f3/i);
  assert.match(webStyles, /--surface:\s*#fafbfa/i);
  assert.match(webStyles, /--border:\s*#dde3df/i);
  assert.match(webStyles, /body\s*\{[^}]*background:\s*var\(--page\)/s);

  const mobilePages = [
    "AuthPage.xaml",
    "HomePage.xaml",
    "MessagesPage.xaml",
    "ConversationPage.xaml",
    "OrdersPage.xaml",
    "OrderWorkspacePage.xaml",
    "ProfilePage.xaml",
  ];

  for (const page of mobilePages) {
    const contents = readFileSync(
      resolve(process.cwd(), "..", "maui/CampusGig.Mobile/Pages", page),
      "utf8",
    );
    assert.match(
      contents,
      /BackgroundColor="\{AppThemeBinding Light=#F3F5F3, Dark=#111713\}"/i,
      page,
    );
  }
});
