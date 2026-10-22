import assert from "node:assert/strict";
import test from "node:test";
import {
  isLegacyOrderPricingModel,
  isLegacyServicePricingModel,
  isSinglePriceV2ServicePricingModel,
  formatDeliveryMinutes,
} from "./pricing-model";

test("legacy pricing models remain compatible with pre-versioned responses", () => {
  assert.equal(isLegacyServicePricingModel(undefined), true);
  assert.equal(isLegacyServicePricingModel("LEGACY_PACKAGES"), true);
  assert.equal(isLegacyOrderPricingModel(undefined), true);
  assert.equal(isLegacyOrderPricingModel("LEGACY_PACKAGE_V1"), true);
});

test("single-price V2 is explicit and duration formatting preserves sub-day terms", () => {
  assert.equal(isSinglePriceV2ServicePricingModel("SINGLE_PRICE_V2"), true);
  assert.equal(isSinglePriceV2ServicePricingModel("FUTURE_PRICE_V3"), false);
  assert.equal(formatDeliveryMinutes(180), "3 hours");
  assert.equal(formatDeliveryMinutes(1440), "1 day");
  assert.equal(formatDeliveryMinutes(2880), "2 days");
  assert.equal(formatDeliveryMinutes(null), "Unavailable");
});

test("future and unknown pricing models are not mistaken for legacy", () => {
  assert.equal(isLegacyServicePricingModel("SINGLE_PRICE_V2"), false);
  assert.equal(isLegacyOrderPricingModel("SINGLE_PRICE_V2"), false);
  assert.equal(isLegacyOrderPricingModel("FUTURE_PRICE_V3"), false);
});
