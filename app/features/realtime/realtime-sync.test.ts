import assert from "node:assert/strict";
import test from "node:test";
import { attachRealtimeSync, type RealtimeSocket } from "./use-realtime-sync";

test("realtime synchronization preserves event refreshes and cleans up", () => {
  const listeners = new Map<string, () => void>();
  let disconnected = false;
  let clearedHandle = 0;
  let fallback: (() => void) | undefined;
  const calls: string[] = [];
  const socket: RealtimeSocket = {
    on(event, listener) {
      listeners.set(event, listener);
      return this;
    },
    disconnect() {
      disconnected = true;
    },
  };

  const cleanup = attachRealtimeSync(
    socket,
    {
      refreshOrders: () => calls.push("orders"),
      refreshMarketplace: () => calls.push("marketplace"),
      refreshNotifications: () => calls.push("notifications"),
    },
    {
      setInterval(callback) {
        fallback = callback;
        return 42;
      },
      clearInterval(handle) {
        clearedHandle = handle;
      },
    },
  );

  listeners.get("connect")?.();
  listeners.get("order:changed")?.();
  listeners.get("payment:changed")?.();
  listeners.get("marketplace:changed")?.();
  listeners.get("notifications:changed")?.();
  fallback?.();

  assert.deepEqual(calls, [
    "orders",
    "marketplace",
    "notifications",
    "orders",
    "orders",
    "marketplace",
    "notifications",
    "orders",
    "marketplace",
    "notifications",
  ]);
  cleanup();
  assert.equal(clearedHandle, 42);
  assert.equal(disconnected, true);
});

test("polling-only mode refreshes every data surface without a socket", () => {
  const calls: string[] = [];
  let fallback: (() => void) | undefined;
  const cleanup = attachRealtimeSync(
    null,
    {
      refreshOrders: () => calls.push("orders"),
      refreshMarketplace: () => calls.push("marketplace"),
      refreshNotifications: () => calls.push("notifications"),
    },
    {
      setInterval(callback) {
        fallback = callback;
        return 7;
      },
      clearInterval() {},
    },
  );

  fallback?.();
  assert.deepEqual(calls, ["orders", "marketplace", "notifications"]);
  cleanup();
});
