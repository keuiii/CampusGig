import assert from "node:assert/strict";
import test from "node:test";
import {
  getCharacterProgress,
  serviceFieldLimits,
} from "./service-field-validation";

test("reports remaining meaningful characters until the minimum is met", () => {
  assert.deepEqual(
    getCharacterProgress(" 12345678 ", serviceFieldLimits.title),
    {
      count: 10,
      remaining: 2,
      ready: false,
    },
  );
});

test("marks a field ready when its trimmed minimum is met", () => {
  assert.deepEqual(
    getCharacterProgress("1234567890", serviceFieldLimits.title),
    {
      count: 10,
      remaining: 0,
      ready: true,
    },
  );
});
