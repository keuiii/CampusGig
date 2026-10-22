import assert from "node:assert/strict";
import test from "node:test";
import { readWebRoute, writeWebRoute } from "./web-route-state";

test("defaults invalid or incomplete routes to the marketplace", () => {
  assert.deepEqual(readWebRoute("?view=unknown"), { view: "home" });
  assert.deepEqual(readWebRoute("?view=service"), { view: "home" });
  assert.deepEqual(readWebRoute("?view=provider-profile"), { view: "home" });
});

test("restores main, service, provider, and order route context", () => {
  assert.equal(readWebRoute("?view=provider").view, "provider");
  assert.deepEqual(
    readWebRoute("?view=service&serviceId=svc-1&returnTo=provider-profile"),
    {
      view: "service",
      serviceId: "svc-1",
      returnTo: "provider-profile",
    },
  );
  assert.equal(
    readWebRoute("?view=provider-profile&providerId=user-1").providerId,
    "user-1",
  );
  assert.equal(readWebRoute("?view=orders&orderId=order-1").orderId, "order-1");
});

test("writes navigation without discarding unrelated URL parameters", () => {
  assert.equal(
    writeWebRoute("http://localhost:3000/?campaign=fall", {
      view: "service",
      serviceId: "svc 1",
      returnTo: "home",
    }),
    "/?campaign=fall&view=service&serviceId=svc+1&returnTo=home",
  );
  assert.equal(
    writeWebRoute("http://localhost:3000/?view=orders&orderId=old", {
      view: "home",
    }),
    "/",
  );
});
