type StorageRemover = Pick<Storage, "removeItem">;

const legacyTrustedDeviceKeys = [
  "campusgig.trustedDevice",
  "campusgig.trustedDevices",
] as const;

export function clearLegacyTrustedDeviceStorage(storage: StorageRemover) {
  for (const key of legacyTrustedDeviceKeys) storage.removeItem(key);
}
