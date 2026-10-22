import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  assertSafeIdentifier,
  assertSafeVerificationDatabaseName,
  buildComposePrefix,
  createBackupStem,
  createVerificationDatabaseName,
  parseBackupArguments,
  renderBackupVerificationMetric,
  validateCriticalCounts,
  validateMigrationParity,
} from "./postgres-backup-lib.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const options = parseBackupArguments(process.argv.slice(2), workspaceRoot);

function dockerArgs(...args) {
  return [...buildComposePrefix(options), ...args];
}

async function run(command, args, { inputFile, outputFile } = {}) {
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    windowsHide: true,
    stdio: [inputFile ? "pipe" : "ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  if (!outputFile) child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  const transfers = [];
  if (inputFile)
    transfers.push(pipeline(createReadStream(inputFile), child.stdin));
  if (outputFile)
    transfers.push(
      pipeline(child.stdout, createWriteStream(outputFile, { flags: "wx" })),
    );

  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  try {
    await Promise.all(transfers);
  } catch (error) {
    if (exit === 0) throw error;
  }
  const errorText = Buffer.concat(stderr).toString("utf8").trim();
  if (exit !== 0) {
    throw new Error(
      `${command} exited with code ${exit}${errorText ? `: ${errorText}` : ""}`,
    );
  }
  return Buffer.concat(stdout).toString("utf8").trim();
}

function composeExec(...command) {
  return run("docker", dockerArgs("exec", "-T", options.service, ...command));
}

function composeExecToFile(outputFile, ...command) {
  return run("docker", dockerArgs("exec", "-T", options.service, ...command), {
    outputFile,
  });
}

function composeExecFromFile(inputFile, ...command) {
  return run("docker", dockerArgs("exec", "-T", options.service, ...command), {
    inputFile,
  });
}

async function preflight() {
  await access(options.composeFile);
  if (options.envFile) await access(options.envFile);
  const services = (await run("docker", dockerArgs("config", "--services")))
    .split(/\r?\n/)
    .filter(Boolean);
  if (!services.includes(options.service)) {
    throw new Error(
      `Compose service ${options.service} does not exist in ${options.composeFile}.`,
    );
  }
  await composeExec("pg_isready");
}

async function containerSetting(name) {
  const value = await composeExec("printenv", name);
  if (!value)
    throw new Error(`${name} is not configured in the PostgreSQL container.`);
  return value;
}

async function databaseContext() {
  const user = assertSafeIdentifier(
    await containerSetting("POSTGRES_USER"),
    "POSTGRES_USER",
  );
  const database = assertSafeIdentifier(
    await containerSetting("POSTGRES_DB"),
    "POSTGRES_DB",
  );
  return { user, database };
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function manifestPathFor(backupFile) {
  return backupFile.endsWith(".dump")
    ? `${backupFile.slice(0, -5)}.manifest.json`
    : `${backupFile}.manifest.json`;
}

async function writeManifest(manifestPath, manifest) {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
  });
}

async function writeVerificationMetric(verifiedAt) {
  const metricRoot = path.join(workspaceRoot, "backups", "metrics");
  const metricPath = path.join(metricRoot, "campusgig-backup.prom");
  const partialPath = `${metricPath}.partial`;
  await mkdir(metricRoot, { recursive: true });
  await writeFile(partialPath, renderBackupVerificationMetric(verifiedAt), {
    encoding: "utf8",
  });
  await rename(partialPath, metricPath);
}

async function loadManifest(manifestPath) {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function query(user, database, sql) {
  return composeExec(
    "psql",
    "--username",
    user,
    "--dbname",
    database,
    "--no-align",
    "--tuples-only",
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    sql,
  );
}

async function createBackup(context) {
  await mkdir(options.backupDir, { recursive: true });
  const backupFile = path.join(options.backupDir, `${createBackupStem()}.dump`);
  const partialFile = `${backupFile}.partial`;
  const manifestPath = manifestPathFor(backupFile);
  try {
    await composeExecToFile(
      partialFile,
      "pg_dump",
      "--username",
      context.user,
      "--dbname",
      context.database,
      "--format=custom",
      "--compress=6",
      "--no-owner",
      "--no-privileges",
    );
    const info = await stat(partialFile);
    if (info.size === 0) throw new Error("pg_dump created an empty backup.");
    await rename(partialFile, backupFile);
    const manifest = {
      formatVersion: 1,
      status: "created",
      createdAt: new Date().toISOString(),
      sourceDatabase: context.database,
      postgresVersion: await query(
        context.user,
        context.database,
        "SHOW server_version;",
      ),
      backupFile: path.basename(backupFile),
      bytes: info.size,
      sha256: await sha256(backupFile),
    };
    await writeManifest(manifestPath, manifest);
    return { backupFile, manifestPath, manifest };
  } catch (error) {
    await rm(partialFile, { force: true });
    throw error;
  }
}

async function expectedMigrations() {
  const entries = await readdir(
    path.join(workspaceRoot, "api", "prisma", "migrations"),
    {
      withFileTypes: true,
    },
  );
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function verificationCounts(user, database) {
  const json = await query(
    user,
    database,
    `SELECT json_build_object(
      'User', (SELECT count(*)::int FROM "User"),
      'Service', (SELECT count(*)::int FROM "Service"),
      'Order', (SELECT count(*)::int FROM "Order"),
      'Payment', (SELECT count(*)::int FROM "Payment"),
      'Message', (SELECT count(*)::int FROM "Message"),
      'Review', (SELECT count(*)::int FROM "Review"),
      'OrderFile', (SELECT count(*)::int FROM "OrderFile"),
      '_prisma_migrations', (SELECT count(*)::int FROM "_prisma_migrations")
    )::text;`,
  );
  return validateCriticalCounts(JSON.parse(json));
}

async function restoredMigrations(user, database) {
  const json = await query(
    user,
    database,
    `SELECT COALESCE(
      json_agg(migration_name ORDER BY started_at),
      '[]'::json
    )::text
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`,
  );
  return JSON.parse(json);
}

async function databaseExists(user, databaseName) {
  assertSafeVerificationDatabaseName(databaseName);
  const result = await query(
    user,
    "postgres",
    `SELECT count(*)::int FROM pg_database WHERE datname = '${databaseName}';`,
  );
  return result === "1";
}

async function dropVerificationDatabase(user, databaseName) {
  assertSafeVerificationDatabaseName(databaseName);
  await query(
    user,
    "postgres",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();`,
  );
  await composeExec(
    "dropdb",
    "--username",
    user,
    "--maintenance-db",
    "postgres",
    "--if-exists",
    databaseName,
  );
  if (await databaseExists(user, databaseName)) {
    throw new Error(
      `Temporary verification database ${databaseName} still exists after cleanup.`,
    );
  }
}

async function verifyBackup(context, backupFile) {
  const resolvedBackup = path.resolve(backupFile);
  const info = await stat(resolvedBackup);
  if (!info.isFile() || info.size === 0)
    throw new Error("Backup file is missing or empty.");
  const manifestPath = manifestPathFor(resolvedBackup);
  const existingManifest = await loadManifest(manifestPath);
  const digest = await sha256(resolvedBackup);
  if (existingManifest?.sha256 && existingManifest.sha256 !== digest) {
    throw new Error("Backup SHA-256 does not match its manifest.");
  }

  const databaseName = createVerificationDatabaseName(
    new Date(),
    randomBytes(4).toString("hex"),
  );
  if (databaseName === context.database)
    throw new Error("Verification database cannot be the source database.");
  if (await databaseExists(context.user, databaseName)) {
    throw new Error(
      `Temporary verification database ${databaseName} already exists.`,
    );
  }

  let created = false;
  let result;
  let failure;
  try {
    await composeExec(
      "createdb",
      "--username",
      context.user,
      "--maintenance-db",
      "postgres",
      "--template",
      "template0",
      "--encoding",
      "UTF8",
      databaseName,
    );
    created = true;
    await composeExecFromFile(
      resolvedBackup,
      "pg_restore",
      "--username",
      context.user,
      "--dbname",
      databaseName,
      "--format=custom",
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
    );
    const counts = await verificationCounts(context.user, databaseName);
    const migrations = await restoredMigrations(context.user, databaseName);
    const migrationCount = validateMigrationParity(
      await expectedMigrations(),
      migrations,
    );
    result = {
      verifiedAt: new Date().toISOString(),
      sha256: digest,
      bytes: info.size,
      migrationCount,
      criticalTableCounts: counts,
    };
  } catch (error) {
    failure = error;
  } finally {
    if (created) {
      try {
        await dropVerificationDatabase(context.user, databaseName);
      } catch (cleanupError) {
        failure = failure
          ? new AggregateError(
              [failure, cleanupError],
              "Restore verification and temporary database cleanup both failed.",
            )
          : cleanupError;
      }
    }
  }
  if (failure) throw failure;
  return {
    ...result,
    temporaryDatabaseRemoved: true,
    manifestPath,
    existingManifest,
  };
}

async function main() {
  await preflight();
  const context = await databaseContext();
  let backup;
  if (options.command === "backup" || options.command === "drill") {
    backup = await createBackup(context);
    console.log(
      `Backup created: ${path.relative(workspaceRoot, backup.backupFile)}`,
    );
    console.log(`SHA-256: ${backup.manifest.sha256}`);
  }
  if (options.command === "verify" || options.command === "drill") {
    const backupFile =
      options.command === "verify" ? options.backupFile : backup.backupFile;
    const verification = await verifyBackup(context, backupFile);
    const manifest = verification.existingManifest ?? {
      formatVersion: 1,
      sourceDatabase: context.database,
      backupFile: path.basename(backupFile),
      bytes: verification.bytes,
      sha256: verification.sha256,
    };
    manifest.status = "verified";
    manifest.verification = {
      verifiedAt: verification.verifiedAt,
      migrationCount: verification.migrationCount,
      criticalTableCounts: verification.criticalTableCounts,
      temporaryDatabaseRemoved: verification.temporaryDatabaseRemoved,
    };
    await writeManifest(verification.manifestPath, manifest);
    await writeVerificationMetric(verification.verifiedAt);
    console.log(`Restore verified: ${verification.migrationCount} migrations`);
    console.log(
      `Temporary verification database removed: ${verification.temporaryDatabaseRemoved}`,
    );
    console.log(
      `Evidence: ${path.relative(workspaceRoot, verification.manifestPath)}`,
    );
  }
}

main().catch((error) => {
  console.error(`Backup/restore drill failed: ${error.message}`);
  process.exitCode = 1;
});
