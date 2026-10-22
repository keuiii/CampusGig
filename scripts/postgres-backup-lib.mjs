import path from "node:path";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const VERIFICATION_DATABASE_PATTERN =
  /^campusgig_restore_verify_[a-z0-9_]{12,48}$/;

export const CRITICAL_TABLES = Object.freeze([
  "User",
  "Service",
  "Order",
  "Payment",
  "Message",
  "Review",
  "OrderFile",
  "_prisma_migrations",
]);

export function assertSafeIdentifier(value, label) {
  if (!IDENTIFIER_PATTERN.test(value ?? "")) {
    throw new Error(
      `${label} must be a PostgreSQL identifier containing only letters, numbers, and underscores.`,
    );
  }
  return value;
}

export function assertSafeVerificationDatabaseName(value) {
  if (!VERIFICATION_DATABASE_PATTERN.test(value ?? "")) {
    throw new Error(
      "Refusing database operation: verification database name is outside the CampusGig safety prefix.",
    );
  }
  return value;
}

export function createVerificationDatabaseName(
  now = new Date(),
  randomSuffix = "000000",
) {
  const timestamp = now
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)
    .toLowerCase();
  const suffix = randomSuffix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return assertSafeVerificationDatabaseName(
    `campusgig_restore_verify_${timestamp}_${suffix || "000000"}`,
  );
}

export function createBackupStem(now = new Date()) {
  return `campusgig-${now.toISOString().replace(/[:.]/g, "-")}`;
}

export function parseBackupArguments(argv, workspaceRoot) {
  const options = {
    command: "drill",
    composeFile: path.join(workspaceRoot, "docker-compose.yml"),
    envFile: undefined,
    service: "postgres",
    backupDir: path.join(workspaceRoot, "backups", "postgres"),
    backupFile: undefined,
  };
  const values = [...argv];
  if (values[0] && !values[0].startsWith("--"))
    options.command = values.shift();
  if (!new Set(["backup", "verify", "drill"]).has(options.command)) {
    throw new Error("Command must be one of: backup, verify, drill.");
  }
  while (values.length) {
    const flag = values.shift();
    const value = values.shift();
    if (!value || value.startsWith("--"))
      throw new Error(`${flag} requires a value.`);
    if (flag === "--compose-file")
      options.composeFile = path.resolve(workspaceRoot, value);
    else if (flag === "--env-file")
      options.envFile = path.resolve(workspaceRoot, value);
    else if (flag === "--service")
      options.service = assertSafeIdentifier(value, "Compose service");
    else if (flag === "--backup-dir")
      options.backupDir = path.resolve(workspaceRoot, value);
    else if (flag === "--backup-file")
      options.backupFile = path.resolve(workspaceRoot, value);
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (options.command === "verify" && !options.backupFile) {
    throw new Error("verify requires --backup-file <path>.");
  }
  return options;
}

export function buildComposePrefix(options) {
  const args = ["compose"];
  if (options.envFile) args.push("--env-file", options.envFile);
  args.push("-f", options.composeFile);
  return args;
}

export function validateMigrationParity(expected, restored) {
  const expectedNames = [...new Set(expected)].sort();
  const restoredNames = [...new Set(restored)].sort();
  const missing = expectedNames.filter((name) => !restoredNames.includes(name));
  const unexpected = restoredNames.filter(
    (name) => !expectedNames.includes(name),
  );
  if (missing.length || unexpected.length) {
    throw new Error(
      `Migration mismatch. Missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}.`,
    );
  }
  return expectedNames.length;
}

export function validateCriticalCounts(counts) {
  for (const table of CRITICAL_TABLES) {
    const count = counts?.[table];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(
        `Restore verification did not return a valid row count for ${table}.`,
      );
    }
  }
  return counts;
}

export function renderBackupVerificationMetric(verifiedAt) {
  const timestamp = Date.parse(verifiedAt);
  if (!Number.isFinite(timestamp))
    throw new Error("Backup verification timestamp is invalid.");
  return [
    "# HELP campusgig_backup_last_verified_timestamp_seconds Unix timestamp of the latest successful restore verification.",
    "# TYPE campusgig_backup_last_verified_timestamp_seconds gauge",
    `campusgig_backup_last_verified_timestamp_seconds ${Math.floor(timestamp / 1000)}`,
    "",
  ].join("\n");
}
