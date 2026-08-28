import assert from "node:assert/strict";
import { test } from "node:test";
import { assertKnownPriceId, createStripePriceMapFromEnv, MissingStripePriceIdError, UnknownStripePriceIdError } from "./priceMap.js";

const FULL_ENV = {
  STRIPE_PRICE_MONTHLY: "price_monthly",
  STRIPE_PRICE_QUARTERLY: "price_quarterly",
  STRIPE_PRICE_YEARLY: "price_yearly",
};

test("createStripePriceMapFromEnv builds the full three-entry map when every env var is set", () => {
  const map = createStripePriceMapFromEnv(FULL_ENV);
  assert.deepEqual(map, {
    monthly: "price_monthly",
    quarterly: "price_quarterly",
    yearly: "price_yearly",
  });
});

test("createStripePriceMapFromEnv throws naming the specific missing env var, not a generic error", () => {
  const { STRIPE_PRICE_YEARLY, ...partialEnv } = FULL_ENV;
  void STRIPE_PRICE_YEARLY;
  assert.throws(() => createStripePriceMapFromEnv(partialEnv), (err: unknown) => {
    assert.ok(err instanceof MissingStripePriceIdError);
    assert.match((err as Error).message, /STRIPE_PRICE_YEARLY/);
    return true;
  });
});

test("assertKnownPriceId accepts every configured price id", () => {
  const map = createStripePriceMapFromEnv(FULL_ENV);
  assert.doesNotThrow(() => assertKnownPriceId(map, "price_monthly"));
  assert.doesNotThrow(() => assertKnownPriceId(map, "price_quarterly"));
  assert.doesNotThrow(() => assertKnownPriceId(map, "price_yearly"));
});

test("assertKnownPriceId throws on an unrecognized price id rather than silently trusting it", () => {
  const map = createStripePriceMapFromEnv(FULL_ENV);
  assert.throws(() => assertKnownPriceId(map, "price_unknown"), (err: unknown) => {
    assert.ok(err instanceof UnknownStripePriceIdError);
    assert.match((err as Error).message, /price_unknown/);
    return true;
  });
});
