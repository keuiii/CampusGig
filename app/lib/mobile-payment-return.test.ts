import assert from "node:assert/strict";
import test from "node:test";
import {
  preferredMobileReturnUrl,
  readMobilePaymentReturn,
} from "./mobile-payment-return";

test("builds encoded app and Android intent returns for a mobile checkout", () => {
  const result = readMobilePaymentReturn(
    "?paymentTarget=mobile&payment=success&orderId=order%2F123",
  );

  assert.ok(result);
  assert.equal(result.status, "success");
  assert.equal(result.orderId, "order/123");
  assert.equal(
    result.deepLink,
    "campusgig://payment-return?payment=success&orderId=order%2F123",
  );
  assert.match(result.androidIntent, /^intent:\/\/payment-return\?/);
  assert.match(result.androidIntent, /package=com\.campusgig\.app;end$/);
  assert.equal(
    preferredMobileReturnUrl(result, "Mozilla/5.0 (Linux; Android 16)"),
    result.androidIntent,
  );
});

test("rejects incomplete, invalid, and non-mobile payment returns", () => {
  assert.equal(readMobilePaymentReturn("?payment=success&orderId=one"), null);
  assert.equal(
    readMobilePaymentReturn("?paymentTarget=mobile&payment=failed&orderId=one"),
    null,
  );
  assert.equal(
    readMobilePaymentReturn("?paymentTarget=mobile&payment=success"),
    null,
  );
});

test("preserves revision purchase identity across the mobile app-link bridge", () => {
  const result = readMobilePaymentReturn(
    "?paymentTarget=mobile&payment=success&orderId=order-1&revisionPurchaseId=revision-purchase-1",
  );
  assert.ok(result);
  assert.equal(result.revisionPurchaseId, "revision-purchase-1");
  assert.match(result.deepLink, /revisionPurchaseId=revision-purchase-1/);
});
