import assert from "node:assert/strict";
import test from "node:test";
import { getGoogleSignInErrorMessage } from "../../mobile/src/auth/google-sign-in-error";

test("explains Android developer error code 10", () => {
  const message = getGoogleSignInErrorMessage({
    code: 10,
    message: "DEVELOPER_ERROR",
  });

  assert.match(message, /com\.campusgig\.app/);
  assert.match(message, /SHA-1/);
});

test("preserves other Google sign-in error messages", () => {
  assert.equal(
    getGoogleSignInErrorMessage({ code: "NETWORK_ERROR", message: "Offline" }),
    "Offline",
  );
});

test("uses a safe fallback for an unknown thrown value", () => {
  assert.equal(getGoogleSignInErrorMessage("failed"), "Please try again.");
});
