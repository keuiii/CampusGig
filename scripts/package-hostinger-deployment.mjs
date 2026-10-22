import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputRoot = join(repositoryRoot, "deploy", "hostinger", "build");
const stageRoot = join(outputRoot, "campusgig-hostinger");
const webSource = join(repositoryRoot, "out");
const apiSource = join(repositoryRoot, "laravel-api");

if (!existsSync(join(webSource, "index.html"))) {
  throw new Error("Run pnpm build:hostinger before packaging the deployment");
}
if (!existsSync(join(apiSource, "composer.lock"))) {
  throw new Error("Laravel composer.lock is missing");
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });

cpSync(webSource, join(stageRoot, "web", "public_html"), { recursive: true });
cpSync(apiSource, join(stageRoot, "api", "laravel-api"), {
  recursive: true,
  filter: productionApiFilter,
});
cpSync(
  join(repositoryRoot, "deploy", "hostinger", "api-public"),
  join(stageRoot, "api", "public_html"),
  { recursive: true },
);
for (const asset of ["favicon.ico", "robots.txt"]) {
  cpSync(
    join(apiSource, "public", asset),
    join(stageRoot, "api", "public_html", asset),
  );
}
cpSync(
  join(repositoryRoot, "deploy", "hostinger", "api.env.example"),
  join(stageRoot, "api", "api.env.example"),
);
cpSync(
  join(repositoryRoot, "docs", "HOSTINGER_PREMIUM_DEPLOYMENT.md"),
  join(stageRoot, "DEPLOYMENT.md"),
);

for (const directory of [
  "api/laravel-api/storage/app/private",
  "api/laravel-api/storage/framework/cache",
  "api/laravel-api/storage/framework/sessions",
  "api/laravel-api/storage/framework/views",
  "api/laravel-api/storage/logs",
  "api/laravel-api/bootstrap/cache",
]) {
  mkdirSync(join(stageRoot, ...directory.split("/")), { recursive: true });
}

assertNoSensitiveFiles(stageRoot);
const manifest = fileManifest(stageRoot);
writeFileSync(
  join(stageRoot, "SHA256SUMS.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2)}\n`,
  "utf8",
);

const archive = join(outputRoot, "campusgig-hostinger.zip");
const packed = spawnSync(
  "tar",
  ["-a", "-c", "-f", archive, basename(stageRoot)],
  { cwd: outputRoot, stdio: "inherit" },
);
if (packed.error) throw packed.error;
if (packed.status !== 0) {
  throw new Error(`tar failed with exit code ${packed.status}`);
}

console.log(`Hostinger bundle: ${archive}`);
console.log(`Manifest entries: ${manifest.length}`);

function productionApiFilter(source) {
  const path = relative(apiSource, source).split(sep).join("/");
  if (path === "") return true;
  const parts = path.split("/");
  if (parts.some((part) => part === "vendor" || part === "node_modules")) {
    return false;
  }
  if (parts[0] === "tests" || parts[0] === "docker") return false;
  if (
    path === "phpunit.xml" ||
    path === ".phpunit.result.cache" ||
    path === "database/database.sqlite" ||
    path === "package.json" ||
    path === "vite.config.js" ||
    path === "README.md" ||
    parts[0] === "scripts" ||
    path === "database/factories" ||
    path.startsWith("database/factories/") ||
    path === "database/seeders" ||
    path.startsWith("database/seeders/") ||
    path === "resources/css" ||
    path.startsWith("resources/css/") ||
    path === "resources/js" ||
    path.startsWith("resources/js/")
  ) {
    return false;
  }
  if (/^\.env(?:\.|$)/i.test(parts.at(-1) ?? "")) return false;
  if (parts[0] === "storage" && parts.length > 1) return false;
  if (path === "bootstrap/cache" || path.startsWith("bootstrap/cache/")) {
    return false;
  }
  if (path === "public/storage" || path.startsWith("public/storage/")) {
    return false;
  }

  return true;
}

function assertNoSensitiveFiles(root) {
  const forbidden = [
    /(^|\/)\.env(?:\.|$)/i,
    /(^|\/)auth\.json$/i,
    /\.(?:jks|keystore|p12|pfx|pem|key)$/i,
    /(^|\/)storage\/app\/private\/.+/i,
    /(^|\/)storage\/logs\/.+/i,
  ];
  const violations = walkFiles(root)
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => forbidden.some((pattern) => pattern.test(path)));
  if (violations.length > 0) {
    throw new Error(`Sensitive files entered the bundle: ${violations.join(", ")}`);
  }
}

function fileManifest(root) {
  return walkFiles(root)
    .map((path) => ({
      path: relative(root, path).split(sep).join("/"),
      bytes: statSync(path).size,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
