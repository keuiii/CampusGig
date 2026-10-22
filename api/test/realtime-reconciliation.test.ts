import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web reconnects reconcile authoritative order, payment, message, and notification state", async () => {
  const [realtimeSync, workspace, providerProfile, providerDashboard] =
    await Promise.all([
    readFile("../app/features/realtime/use-realtime-sync.ts", "utf8"),
    readFile("../app/features/orders/WebOrderWorkspace.tsx", "utf8"),
    readFile(
      "../app/features/marketplace/PublicProviderProfileView.tsx",
      "utf8",
    ),
      readFile("../app/features/provider/ProviderDashboard.tsx", "utf8"),
    ]);

  assert.match(
    realtimeSync,
    /socket\.on\("connect", \(\) => \{[\s\S]*refreshOrders\(\);[\s\S]*refreshNotifications\(\)/,
  );
  assert.match(
    workspace,
    /socket\?\.on\("connect", \(\) => \{[\s\S]*conversation:subscribe[\s\S]*void refresh\(\)/,
  );
  assert.match(workspace, /const refreshSequence = useRef\(0\)/);
  assert.match(
    workspace,
    /if \(sequence !== refreshSequence\.current\) return/,
  );
  assert.match(
    providerProfile,
    /socket\?\.on\("connect", \(\) => \{[\s\S]*provider:subscribe[\s\S]*refresh\(\)/,
  );
  assert.match(providerDashboard, /socket\.on\("order:changed"/);
  assert.match(providerDashboard, /socket\.on\("payment:changed"/);
  assert.match(
    providerDashboard,
    /socket\.on\("connect", \(\) => \{[\s\S]*refreshActivity\(\)/,
  );
  assert.match(providerDashboard, /setInterval[\s\S]*10000/);
  assert.match(realtimeSync, /setInterval\(callbacks\.refreshOrders, 10000\)/);
});

test("mobile reconnects restore private rooms and notify active views to reconcile", async () => {
  const [service, orderWorkspace, conversation, orders, messages] =
    await Promise.all([
      readFile("../maui/CampusGig.Mobile/Services/RealtimeService.cs", "utf8"),
      readFile(
        "../maui/CampusGig.Mobile/Pages/OrderWorkspacePage.xaml.cs",
        "utf8",
      ),
      readFile(
        "../maui/CampusGig.Mobile/Pages/ConversationPage.xaml.cs",
        "utf8",
      ),
      readFile("../maui/CampusGig.Mobile/Pages/OrdersPage.xaml.cs", "utf8"),
      readFile("../maui/CampusGig.Mobile/Pages/MessagesPage.xaml.cs", "utf8"),
    ]);

  assert.match(service, /RestoreSubscriptionsAsync\(newSocket\)/);
  assert.match(service, /conversation:subscribe/);
  assert.match(service, /provider:subscribe/);
  assert.match(service, /ReconciliationRequired\?\.Invoke\(\)/);
  for (const view of [orderWorkspace, conversation, orders, messages])
    assert.match(view, /ReconciliationRequired \+=/);
});
