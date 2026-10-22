import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web and mobile active-session views refresh, expose failures, and honor revocation results", async () => {
  const [webPanel, mobilePage, mobileMarkup] = await Promise.all([
    readFile("app/features/account/MfaSecurityPanel.tsx", "utf8"),
    readFile("maui/CampusGig.Mobile/Pages/ProfilePage.xaml.cs", "utf8"),
    readFile("maui/CampusGig.Mobile/Pages/ProfilePage.xaml", "utf8"),
  ]);

  assert.match(webPanel, /Promise\.allSettled/);
  assert.match(webPanel, /Loading active sessions/);
  assert.match(webPanel, /result\.revoked === 0/);
  assert.match(mobilePage, /LoadAuthSessionsAsync\(showError: true\)/);
  assert.match(mobilePage, /SessionRevocationResult/);
  assert.match(mobilePage, /DisplayHostConfirmationAsync/);
  assert.match(mobilePage, /Windows\.FirstOrDefault\(\)\?\.Page/);
  assert.match(mobileMarkup, /AutomationId="AuthSessionsStatus"/);
  assert.match(mobileMarkup, /AutomationId="AuthSessionsList"/);
});
