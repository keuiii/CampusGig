import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
if (!apiUrl) throw new Error("NEXT_PUBLIC_API_URL is required");
const parsed = new URL(apiUrl);
if (parsed.protocol !== "https:")
  throw new Error("NEXT_PUBLIC_API_URL must use HTTPS for Hostinger builds");

const next = resolve(
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const result = spawnSync(process.execPath, [next, "build"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CAMPUSGIG_STATIC_EXPORT: "true",
    NEXT_PUBLIC_REALTIME_MODE: "polling",
  },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
