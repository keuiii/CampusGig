import assert from "node:assert/strict";
import test from "node:test";
import { clearLegacyTrustedDeviceStorage } from "./trusted-device-storage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test("legacy JavaScript-readable trusted-device tokens are removed", () => {
  const storage = memoryStorage();
  storage.setItem("campusgig.trustedDevice", "legacy-token");
  storage.setItem(
    "campusgig.trustedDevices",
    JSON.stringify({ "student@example.com": "account-token" }),
  );

  clearLegacyTrustedDeviceStorage(storage);

  assert.equal(storage.getItem("campusgig.trustedDevice"), null);
  assert.equal(storage.getItem("campusgig.trustedDevices"), null);
});
