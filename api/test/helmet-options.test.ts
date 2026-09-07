import assert from "node:assert/strict";
import test from "node:test";
import { createHelmetOptions } from "../src/security/helmet-options";

test("development allows HTTP password-review form submissions", () => {
  const options = createHelmetOptions("development");

  assert.equal(
    options.contentSecurityPolicy.directives["upgrade-insecure-requests"],
    null,
  );
});

test("an unset environment uses the safe local-development behavior", () => {
  const options = createHelmetOptions(undefined);

  assert.equal(
    options.contentSecurityPolicy.directives["upgrade-insecure-requests"],
    null,
  );
});

test("production retains HTTPS request upgrading", () => {
  const options = createHelmetOptions("production");

  assert.deepEqual(
    options.contentSecurityPolicy.directives["upgrade-insecure-requests"],
    [],
  );
});
