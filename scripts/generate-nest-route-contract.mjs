import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceRoot = join(repositoryRoot, "api", "src");
const output = join(
  repositoryRoot,
  "laravel-api",
  "tests",
  "Fixtures",
  "nest-route-contract.json",
);
const decorator = /@(Controller|Get|Post|Put|Patch|Delete)\(\s*(?:["']([^"']*)["'])?\s*\)/g;
const routes = [];

for (const file of walk(sourceRoot).filter((path) => path.endsWith(".controller.ts"))) {
  const source = readFileSync(file, "utf8");
  let prefix = null;
  for (const match of source.matchAll(decorator)) {
    const [, kind, path = ""] = match;
    if (kind === "Controller") {
      prefix = path;
      continue;
    }
    if (prefix === null) {
      throw new Error(`Route decorator before controller in ${file}`);
    }
    routes.push({
      method: kind.toUpperCase(),
      path: normalizePath(`/api/v1/${prefix}/${path}`),
      source: relative(repositoryRoot, file).split(sep).join("/"),
    });
  }
}

routes.sort((left, right) =>
  `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`),
);
const duplicates = routes.filter(
  (route, index) =>
    index > 0 &&
    route.method === routes[index - 1].method &&
    route.path === routes[index - 1].path,
);
if (duplicates.length > 0) {
  throw new Error(`Duplicate NestJS routes: ${JSON.stringify(duplicates)}`);
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(routes, null, 2)}\n`, "utf8");
console.log(`Wrote ${routes.length} NestJS routes to ${output}`);

function normalizePath(path) {
  return path
    .replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "") || "/";
}

function walk(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
