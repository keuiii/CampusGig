import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) =>
  readFile(new URL(path, import.meta.url), "utf8");

test("Web V2 booking uses an authenticated server quote and transparent breakdown", async () => {
  const [marketplace, api] = await Promise.all([
    source("./MarketplaceViews.tsx"),
    source("../../lib/api.ts"),
  ]);
  assert.match(api, /services\/\$\{serviceId\}\/quote/);
  assert.match(
    marketplace,
    /quoteService\(token, service\.id, deliveryOption\)/,
  );
  assert.match(marketplace, /Service price/);
  assert.match(marketplace, /CampusGig service fee/);
  assert.match(marketplace, /rushSurchargeCentavos/);
  assert.doesNotMatch(marketplace, /Booking coming in a later phase/);
});

test("Web creates V2 orders without package or requested date authority", async () => {
  const [marketplace, page] = await Promise.all([
    source("./MarketplaceViews.tsx"),
    source("../../page.tsx"),
  ]);
  assert.match(
    marketplace,
    /legacyPricing \? selectedPackage!\.id : undefined/,
  );
  assert.match(marketplace, /singlePriceV2 \? deliveryOption : undefined/);
  assert.match(page, /deliveryOption/);
});

test("Web order workspace renders pending and exact V2 deadlines safely", async () => {
  const workspace = await source("../orders/WebOrderWorkspace.tsx");
  assert.match(workspace, /Starts after payment confirmation/);
  assert.match(workspace, /formatCampusDate\(active\.dueAt\)/);
  assert.match(workspace, /SELECTED DELIVERY/);
  assert.match(workspace, /Base service/);
});

test("Android download stays in an accessible header dialog", async () => {
  const [page, marketplace, download] = await Promise.all([
    source("../../page.tsx"),
    source("./MarketplaceViews.tsx"),
    source("../../components/android-app-download.tsx"),
  ]);
  assert.match(page, /<AndroidAppDownload \/>/);
  assert.doesNotMatch(marketplace, /className="android-download"/);
  assert.match(download, /aria-haspopup="dialog"/);
  assert.match(download, /role="dialog"/);
  assert.match(download, /aria-modal="true"/);
  assert.match(download, /event\.key === "Escape"/);
  assert.match(download, /campusgig-download-qr\.svg/);
  assert.match(download, /downloads\/campusgig-android\.apk/);
});
