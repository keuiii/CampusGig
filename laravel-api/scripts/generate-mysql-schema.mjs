import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const sourcePath = resolve(repositoryRoot, "api/prisma/schema.prisma");
const schemaDirectory = resolve(repositoryRoot, "laravel-api/database/schema");
const mysqlSchemaPath = resolve(schemaDirectory, "campusgig.mysql.prisma");
const mysqlSqlPath = resolve(schemaDirectory, "campusgig.mysql.sql");
const prismaExecutable = process.execPath;
const prismaEntryPoint = resolve(
  repositoryRoot,
  "api/node_modules/prisma/build/index.js",
);

const source = readFileSync(sourcePath, "utf8");
const textFields = new Set([
  "bio",
  "body",
  "comment",
  "description",
  "details",
    "externalReferenceToken",
  "instructions",
  "message",
  "note",
  "processingError",
  "reconciliationContext",
  "rejectionReason",
  "requirements",
  "resolutionNote",
  "reviewNote",
  "settlementNote",
]);
const mysqlSchema = source
  .replace('provider = "postgresql"', 'provider = "mysql"')
  .replaceAll("@db.Uuid", "@db.Char(36)")
  .replace(/^\s*skills\s+String\[\]\s*$/m, "  skills           Json     @default(\"[]\")")
  .replace(/^(\s*)([A-Za-z][A-Za-z0-9]*)(\s+String\??)(\s*(?:@.*)?)$/gm, (line, indent, field, type, attributes) => {
    if (!textFields.has(field) || attributes.includes("@db.")) return line;
    return `${indent}${field}${type}${attributes} @db.Text`;
  });

if (mysqlSchema === source) {
  throw new Error("Prisma schema conversion made no changes");
}
if (mysqlSchema.includes('@db.Uuid') || mysqlSchema.includes('String[]')) {
  throw new Error("Unsupported PostgreSQL-only types remain in the MySQL schema");
}
for (const field of textFields) {
  const pattern = new RegExp(`^\\s*${field}\\s+String\\??(?:\\s+[^\\n]*)?@db\\.Text\\s*$`, "m");
  if (!pattern.test(mysqlSchema)) {
    throw new Error(`Expected long-text mapping is missing for ${field}`);
  }
}

mkdirSync(schemaDirectory, { recursive: true });
writeFileSync(mysqlSchemaPath, mysqlSchema, "utf8");

const environment = {
  ...process.env,
  DATABASE_URL: "mysql://campusgig:campusgig@127.0.0.1:3306/campusgig",
};

execFileSync(
  prismaExecutable,
  [prismaEntryPoint, "format", "--schema", mysqlSchemaPath],
  { cwd: repositoryRoot, env: environment, stdio: "inherit" },
);
execFileSync(
  prismaExecutable,
  [prismaEntryPoint, "validate", "--schema", mysqlSchemaPath],
  { cwd: repositoryRoot, env: environment, stdio: "inherit" },
);

const ddl = execFileSync(
  prismaExecutable,
  [
    prismaEntryPoint,
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema-datamodel",
    mysqlSchemaPath,
    "--script",
  ],
  { cwd: repositoryRoot, env: environment, encoding: "utf8" },
);

if (!ddl.includes("CREATE TABLE") || !ddl.includes("FOREIGN KEY")) {
  throw new Error("Generated MySQL DDL is incomplete");
}

writeFileSync(
  mysqlSqlPath,
  `-- Generated from api/prisma/schema.prisma. Do not edit manually.\n${ddl}`,
  "utf8",
);

console.log(`Generated ${mysqlSchemaPath}`);
console.log(`Generated ${mysqlSqlPath}`);
