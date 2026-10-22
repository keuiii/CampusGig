import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  assertSafeIdentifier,
  assertSafeVerificationDatabaseName,
  buildComposePrefix,
  createVerificationDatabaseName,
  parseBackupArguments,
  renderBackupVerificationMetric,
  validateCriticalCounts,
  validateMigrationParity,
} from "./postgres-backup-lib.mjs";

test("verification database names are narrowly scoped", () => {
  const name = createVerificationDatabaseName(
    new Date("2026-09-28T02:00:00.000Z"),
    "a1b2c3",
  );
  assert.equal(name, "campusgig_restore_verify_20260928020000_a1b2c3");
  assert.throws(
    () => assertSafeVerificationDatabaseName("campusgig"),
    /Refusing database operation/,
  );
  assert.throws(
    () => assertSafeVerificationDatabaseName("campusgig_restore_verify_;drop"),
    /Refusing database operation/,
  );
  assert.throws(
    () => assertSafeIdentifier("postgres;drop", "Service"),
    /PostgreSQL identifier/,
  );
});

test("verified backups expose a valid node-exporter textfile metric", () => {
  assert.equal(
    renderBackupVerificationMetric("2026-09-28T02:00:00.000Z"),
    "# HELP campusgig_backup_last_verified_timestamp_seconds Unix timestamp of the latest successful restore verification.\n# TYPE campusgig_backup_last_verified_timestamp_seconds gauge\ncampusgig_backup_last_verified_timestamp_seconds 1790560800\n",
  );
  assert.throws(
    () => renderBackupVerificationMetric("not-a-date"),
    /timestamp is invalid/,
  );
});

test("backup arguments are explicit and compose paths remain platform safe", () => {
  const root = path.resolve("C:/CampusGig");
  const options = parseBackupArguments(
    [
      "drill",
      "--compose-file",
      "deploy/staging/compose.yml",
      "--env-file",
      "deploy/staging/.env",
      "--service",
      "postgres",
    ],
    root,
  );
  assert.equal(options.command, "drill");
  assert.deepEqual(buildComposePrefix(options), [
    "compose",
    "--env-file",
    path.resolve(root, "deploy/staging/.env"),
    "-f",
    path.resolve(root, "deploy/staging/compose.yml"),
  ]);
  assert.throws(
    () => parseBackupArguments(["verify"], root),
    /requires --backup-file/,
  );
});

test("migration and critical-table verification reject incomplete restores", () => {
  assert.equal(validateMigrationParity(["001", "002"], ["002", "001"]), 2);
  assert.throws(
    () => validateMigrationParity(["001", "002"], ["001"]),
    /Missing: 002/,
  );
  const counts = Object.fromEntries(
    [
      "User",
      "Service",
      "Order",
      "Payment",
      "Message",
      "Review",
      "OrderFile",
      "_prisma_migrations",
    ].map((name) => [name, 0]),
  );
  assert.equal(validateCriticalCounts(counts), counts);
  assert.throws(
    () => validateCriticalCounts({ ...counts, Payment: -1 }),
    /Payment/,
  );
});
