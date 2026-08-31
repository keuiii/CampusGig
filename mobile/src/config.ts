export const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

export const STORAGE_KEYS = {
  accessToken: "campusgig.accessToken",
  nightMode: "campusgig.nightMode",
  downloadDirectory: "campusgig.downloadDirectory",
} as const;
