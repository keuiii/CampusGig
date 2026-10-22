import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  providerServiceActions,
  providerServiceStatusCopy,
} from "./service-lifecycle";

test("published listings can start a moderated revision", () => {
  assert.deepEqual(providerServiceActions("PUBLISHED"), [
    "preview",
    "edit",
    "pause",
    "archive",
  ]);
});

test("paused and archived listings require explicit safe restoration", () => {
  assert.deepEqual(providerServiceActions("PAUSED"), [
    "preview",
    "edit",
    "resume",
    "archive",
  ]);
  assert.deepEqual(providerServiceActions("ARCHIVED"), ["preview", "restore"]);
  assert.match(providerServiceStatusCopy("ARCHIVED"), /hidden/i);
});

test("approved listing edits use a private revision confirmation and endpoint", async () => {
  const dashboard = await readFile(
    "app/features/provider/ProviderDashboard.tsx",
    "utf8",
  );
  assert.match(dashboard, /api\.reviseProviderService\(token, service\.id\)/);
  assert.match(
    dashboard,
    /disappear from Discover until an administrator approves it again/,
  );
  assert.match(dashboard, /Existing orders will not change/);
});

test("draft and moderation states cannot bypass approval", () => {
  assert.deepEqual(providerServiceActions("DRAFT"), [
    "preview",
    "edit",
    "submit",
  ]);
  assert.deepEqual(providerServiceActions("PENDING_REVIEW"), ["preview"]);
});

test("listing previews remain scrollable with accessible navigation and centered status badges", async () => {
  const [dashboard, styles, mobileListings, mobileProfile] = await Promise.all([
    readFile("app/features/provider/ProviderDashboard.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
    readFile("maui/CampusGig.Mobile/Pages/ProviderListingsPage.cs", "utf8"),
    readFile("maui/CampusGig.Mobile/Pages/ProfilePage.xaml.cs", "utf8"),
  ]);

  assert.match(dashboard, /createPortal\(/);
  assert.match(dashboard, /document\.body/);
  assert.match(styles, /max-height:\s*calc\(100dvh - 48px\)/);
  assert.match(styles, /overflow-y:\s*auto/);
  assert.match(
    styles,
    /\.listing-status\s*\{[\s\S]*?align-items:\s*center[\s\S]*?\}/,
  );
  assert.match(mobileListings, /VerticalOptions = LayoutOptions\.Center/);
  assert.match(mobileListings, /VerticalTextAlignment = TextAlignment\.Center/);
  assert.match(
    mobileListings,
    /NavigationPage\.SetHasNavigationBar\(this, false\)/,
  );
  assert.match(mobileListings, /Title = "Listing preview"/);
  assert.match(mobileProfile, /NavigationPage\.BarBackgroundColorProperty/);
  assert.match(mobileProfile, /NavigationPage\.BarTextColorProperty/);
  assert.match(mobileProfile, /#0F6B4F/);
  assert.match(mobileProfile, /#D9F36A/);
});
