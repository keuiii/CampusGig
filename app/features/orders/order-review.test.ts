import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { MarketplaceOrder } from "../../types";
import {
  completionExplanation,
  hasActiveReviewWindow,
  reviewTimeRemaining,
} from "./order-review";

const baseOrder = {
  status: "SUBMITTED",
  reviewPolicyVersion: 1,
  reviewDeadlineAt: "2026-10-08T00:00:00.000Z",
} as MarketplaceOrder;

test("review countdown is inclusive and rounds partial minutes up", () => {
  assert.equal(
    reviewTimeRemaining(
      baseOrder.reviewDeadlineAt,
      Date.parse("2026-10-07T22:29:01.000Z"),
    ),
    "1h 31m remaining",
  );
  assert.equal(
    reviewTimeRemaining(
      baseOrder.reviewDeadlineAt,
      Date.parse(baseOrder.reviewDeadlineAt!),
    ),
    "Review period ended",
  );
});

test("only a submitted policy-v1 order exposes an active review window", () => {
  assert.equal(hasActiveReviewWindow(baseOrder), true);
  assert.equal(
    hasActiveReviewWindow({ ...baseOrder, status: "COMPLETED" }),
    false,
  );
  assert.equal(
    hasActiveReviewWindow({ ...baseOrder, reviewPolicyVersion: null }),
    false,
  );
});

test("completion messaging distinguishes explicit and automatic completion", () => {
  assert.match(
    completionExplanation({
      ...baseOrder,
      completionSource: "CLIENT_ACCEPTED",
    })!,
    /client accepted/i,
  );
  assert.match(
    completionExplanation({
      ...baseOrder,
      completionSource: "AUTO_REVIEW_TIMEOUT",
    })!,
    /48-hour delivery review period ended/i,
  );
  assert.equal(completionExplanation(baseOrder), null);
});

test("workspace presents Phase F actions and no payout controls", () => {
  const workspace = readFileSync(
    new URL("./WebOrderWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(workspace, /48-HOUR DELIVERY REVIEW/);
  assert.match(workspace, /Awaiting client review/);
  assert.match(workspace, /Accept delivery/);
  assert.match(workspace, /Request revision/);
  assert.match(workspace, /Report a problem/);
  assert.match(workspace, /Downloading a file does not automatically accept/);
  assert.match(workspace, /Completed automatically after the review period/);
  assert.match(workspace, /earning remains pending while the client reviews/);
  assert.doesNotMatch(workspace, /Withdraw|Cash Out/i);
});
