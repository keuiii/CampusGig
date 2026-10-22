import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("my orders refresh exposes accessible motion states", () => {
  const ordersView = readFileSync(
    resolve(root, "app/features/orders/OrdersView.tsx"),
    "utf8",
  );
  const styles = readFileSync(resolve(root, "app/globals.css"), "utf8");

  assert.match(ordersView, /const handleRefresh = async/);
  assert.match(ordersView, /Icon name="refresh"/);
  assert.match(ordersView, /aria-busy=\{manualRefreshing\}/);
  assert.match(ordersView, /aria-live="polite"/);
  assert.match(ordersView, /data-refresh-cycle=\{refreshCycle\}/);
  assert.match(styles, /\.client-orders-table\.is-refreshing::after/);
  assert.match(styles, /@keyframes orders-refresh-spin/);
  assert.match(styles, /@keyframes orders-row-reveal/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
