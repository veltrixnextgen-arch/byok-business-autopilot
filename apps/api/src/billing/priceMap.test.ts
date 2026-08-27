import assert from "node:assert/strict";
import { test } from "node:test";
import { createStripePriceMapFromEnv, MissingStripePriceIdError, tierForPriceId } from "./priceMap.js";

const FULL_ENV = {
  STRIPE_PRICE_SOLO_MONTHLY: "price_solo_m",
  STRIPE_PRICE_SOLO_ANNUAL: "price_solo_a",
  STRIPE_PRICE_COMPANY_MONTHLY: "price_company_m",
  STRIPE_PRICE_COMPANY_ANNUAL: "price_company_a",
  STRIPE_PRICE_SCALE_MONTHLY: "price_scale_m",
  STRIPE_PRICE_SCALE_ANNUAL: "price_scale_a",
};

test("createStripePriceMapFromEnv builds the full six-entry map when every env var is set", () => {
  const map = createStripePriceMapFromEnv(FULL_ENV);
  assert.deepEqual(map, {
    solo: { monthly: "price_solo_m", annual: "price_solo_a" },
    company: { monthly: "price_company_m", annual: "price_company_a" },
    scale: { monthly: "price_scale_m", annual: "price_scale_a" },
  });
});

test("createStripePriceMapFromEnv throws naming the specific missing env var, not a generic error", () => {
  const { STRIPE_PRICE_SCALE_ANNUAL, ...partialEnv } = FULL_ENV;
  void STRIPE_PRICE_SCALE_ANNUAL;
  assert.throws(() => createStripePriceMapFromEnv(partialEnv), (err: unknown) => {
    assert.ok(err instanceof MissingStripePriceIdError);
    assert.match((err as Error).message, /STRIPE_PRICE_SCALE_ANNUAL/);
    return true;
  });
});

test("tierForPriceId resolves every configured price id back to its real tier", () => {
  const map = createStripePriceMapFromEnv(FULL_ENV);
  assert.equal(tierForPriceId(map, "price_solo_m"), "solo");
  assert.equal(tierForPriceId(map, "price_company_a"), "company");
  assert.equal(tierForPriceId(map, "price_scale_m"), "scale");
});

test("tierForPriceId throws on an unrecognized price id rather than guessing a tier", () => {
  const map = createStripePriceMapFromEnv(FULL_ENV);
  assert.throws(() => tierForPriceId(map, "price_unknown"), /price_unknown/);
});
