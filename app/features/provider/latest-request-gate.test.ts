import assert from "node:assert/strict";
import test from "node:test";
import { LatestRequestGate } from "./latest-request-gate";

test("only the newest provider activity request may update the dashboard", () => {
  const gate = new LatestRequestGate();
  const initialRequest = gate.begin();
  const realtimeRequest = gate.begin();

  assert.equal(gate.isLatest(initialRequest), false);
  assert.equal(gate.isLatest(realtimeRequest), true);
});

test("a later review refresh supersedes a completion refresh", () => {
  const gate = new LatestRequestGate();
  const completionRequest = gate.begin();
  const reviewRequest = gate.begin();

  assert.equal(gate.isLatest(completionRequest), false);
  assert.equal(gate.isLatest(reviewRequest), true);
});
