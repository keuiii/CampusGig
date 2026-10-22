import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { resolveRequestedDeliveryDate } from "../src/modules/orders/delivery-date";

const root = resolve(import.meta.dirname, "../..");
const now = new Date("2026-09-14T03:00:00.000Z");

test("requested delivery dates use Manila calendar days and package lead time", () => {
  assert.equal(
    resolveRequestedDeliveryDate("2026-09-17", 3, now).toISOString(),
    "2026-09-17T15:59:59.999Z",
  );
  assert.equal(
    resolveRequestedDeliveryDate(undefined, 3, now).toISOString(),
    "2026-09-17T15:59:59.999Z",
  );
});

test("invalid, premature, and excessive delivery dates are rejected", () => {
  assert.throws(
    () => resolveRequestedDeliveryDate("2026-09-16", 3, now),
    BadRequestException,
  );
  assert.throws(
    () => resolveRequestedDeliveryDate("2026-02-30", 3, now),
    BadRequestException,
  );
  assert.throws(
    () => resolveRequestedDeliveryDate("2027-09-15", 3, now),
    BadRequestException,
  );
});

test("web and MAUI booking submit a delivery date and stable request identifier", () => {
  const web = readFileSync(
    resolve(root, "app/features/marketplace/MarketplaceViews.tsx"),
    "utf8",
  );
  const mobile = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/Pages/ServiceBookingPage.cs"),
    "utf8",
  );
  const webShell = readFileSync(resolve(root, "app/page.tsx"), "utf8");
  assert.match(web, /type="date"/);
  assert.match(web, /requestedDeliveryDate/);
  assert.match(web, /Requested delivery/);
  assert.match(webShell, /clientRequestId: globalThis\.crypto\.randomUUID\(\)/);
  assert.match(webShell, /orderSubmissionRef/);
  assert.match(mobile, /requestedDeliveryDate/);
  assert.match(mobile, /REQUESTED DELIVERY DATE/);
  assert.match(mobile, /"yyyy-MM-dd"/);
  assert.match(mobile, /submissionRequestId = Guid\.NewGuid\(\)\.ToString\(\)/);
  assert.match(mobile, /clientRequestId = submissionRequestId/);
});

test("MAUI applies keyboard dismissal across the whole app", () => {
  const appResources = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/App.xaml"),
    "utf8",
  );
  const startup = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/MauiProgram.cs"),
    "utf8",
  );
  const androidActivity = readFileSync(
    resolve(root, "maui/CampusGig.Mobile/Platforms/Android/MainActivity.cs"),
    "utf8",
  );
  assert.match(appResources, /TargetType="ContentPage"/);
  assert.match(appResources, /Property="HideSoftInputOnTapped" Value="True"/);
  assert.match(
    startup,
    /EntryHandler\.Mapper\.AppendToMapping\("CampusGigKeyboardDismissal"/,
  );
  assert.match(
    startup,
    /EditorHandler\.Mapper\.AppendToMapping\("CampusGigKeyboardDismissal"/,
  );
  assert.match(
    startup,
    /SearchBarHandler\.Mapper\.AppendToMapping\("CampusGigKeyboardDismissal"/,
  );
  assert.match(startup, /input\.Unfocus\(\)/);
  assert.match(androidActivity, /override bool DispatchTouchEvent/);
  assert.match(androidActivity, /CurrentFocus is EditText focusedInput/);
  assert.match(androidActivity, /HideSoftInputFromWindow/);
  assert.match(androidActivity, /!tappedInsideInput/);
});
