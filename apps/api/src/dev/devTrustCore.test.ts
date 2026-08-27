import assert from "node:assert/strict";
import { test } from "node:test";
import { CUSTOMIZE_MODEL, ONBOARDING_MODEL, VALIDATE_MODEL } from "@byok/extraction";
import { DEV_TIER_MODEL_MAP, TIER_MODEL_MAPS_BY_PROVIDER, loadDevPricingTable } from "./devTrustCore.js";

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

// Same regression class, extended to every provider (ADR-048): a typo'd
// OpenAI/Google model id here would throw UnknownModelError the moment any
// real task actually reached CostGate for that role, not at boot.
test("every model referenced by every provider's tier map has a pricing entry, and its provider matches", () => {
  const pricingTable = loadDevPricingTable();

  for (const [provider, modelMap] of Object.entries(TIER_MODEL_MAPS_BY_PROVIDER)) {
    for (const [tier, modelId] of Object.entries(modelMap)) {
      const entry = pricingTable.priceFor(modelId);
      assert.equal(entry.provider, provider, `${provider}'s ${tier} entry ("${modelId}") is priced under provider "${entry.provider}" instead`);
    }
  }
});
