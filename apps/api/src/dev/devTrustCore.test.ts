import assert from "node:assert/strict";
import { test } from "node:test";
import { CUSTOMIZE_MODEL, ONBOARDING_MODEL, VALIDATE_MODEL } from "@byok/extraction";
import { DEV_TIER_MODEL_MAP, loadDevPricingTable } from "./devTrustCore.js";

// Regression test for a real bug: DEV_TIER_MODEL_MAP's T1 entry once read
// "claude-haiku-4-5" (missing extraction's actual "-20251001" suffix), so
// the cost gate would have thrown UnknownModelError the moment a real
// onboarding batch tried to reserve against it. Every model id the tier
// router maps to, and every model id extraction's internal calls actually
// request, must have a pricing entry — this fails loudly on the next
// model swap instead of silently at request time.
test("every model referenced by the tier router or extraction has a pricing entry", () => {
  const pricingTable = loadDevPricingTable();
  const modelIds = [...Object.values(DEV_TIER_MODEL_MAP), CUSTOMIZE_MODEL, VALIDATE_MODEL, ONBOARDING_MODEL];

  for (const id of modelIds) {
    assert.doesNotThrow(() => pricingTable.priceFor(id), `missing pricing entry for model "${id}"`);
  }
});
