import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateWebPassword,
  webPasswordConfirmationMatches,
} from "./web-password-rules";

test("matches the four password-strength levels used by mobile", () => {
  assert.equal(evaluateWebPassword("").label, "");
  assert.equal(evaluateWebPassword("password").label, "Weak");
  assert.equal(evaluateWebPassword("Password").label, "Fair");
  assert.equal(evaluateWebPassword("Password1").label, "Good");
  assert.equal(evaluateWebPassword("Password1!").label, "Strong");
});

test("requires a non-empty exact password confirmation", () => {
  assert.equal(webPasswordConfirmationMatches("Password1!", ""), false);
  assert.equal(
    webPasswordConfirmationMatches("Password1!", "Password1"),
    false,
  );
  assert.equal(
    webPasswordConfirmationMatches("Password1!", "Password1!"),
    true,
  );
});
