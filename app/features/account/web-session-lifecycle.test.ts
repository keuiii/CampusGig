import assert from "node:assert/strict";
import test from "node:test";
import { clearLegacyAccessTokenStorage } from "./use-web-session";

test("legacy web access tokens are removed without touching unrelated storage", () => {
  const values = new Map<string, string>([
    ["campusgig.webToken", "web"],
    ["campusgig.adminToken", "admin"],
    ["campusgig.providerToken", "provider"],
    ["campusgig.theme", "dark"],
  ]);
  const storage = {
    removeItem: (key: string) => values.delete(key),
  } as unknown as Storage;

  clearLegacyAccessTokenStorage(storage);

  assert.deepEqual([...values], [["campusgig.theme", "dark"]]);
});
