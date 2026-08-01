import { test } from "node:test";
import assert from "node:assert/strict";
import { PricingTable, StalePricingTableError, UnknownModelError } from "./pricing.js";

function freshTable(overrides: Partial<{ lastVerified: string; staleAfterDays: number }> = {}) {
  return new PricingTable(
    {
      version: 1,
      lastVerified: overrides.lastVerified ?? new Date().toISOString().slice(0, 10),
      prices: {
        "claude-sonnet-4-6": { provider: "anthropic", tier: "T2", inputPerMTok: 3.0, outputPerMTok: 15.0 },
      },
    },
    overrides.staleAfterDays ?? 45,
  );
}

test("priceFor returns the entry for a known, fresh model", () => {
  const table = freshTable();
  const price = table.priceFor("claude-sonnet-4-6");
  assert.equal(price.provider, "anthropic");
  assert.equal(price.tier, "T2");
});

test("priceFor throws UnknownModelError for a model not in the table", () => {
  const table = freshTable();
  assert.throws(() => table.priceFor("gpt-nonexistent"), UnknownModelError);
});

test("fail-closed: priceFor throws StalePricingTableError once past the staleness threshold", () => {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const table = freshTable({ lastVerified: sixtyDaysAgo, staleAfterDays: 45 });
  assert.throws(() => table.priceFor("claude-sonnet-4-6"), StalePricingTableError);
});

test("a table exactly at the staleness boundary is still usable, one day past is not", () => {
  const fortyFourDaysAgo = new Date(Date.now() - 44 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const withinBound = freshTable({ lastVerified: fortyFourDaysAgo, staleAfterDays: 45 });
  assert.doesNotThrow(() => withinBound.priceFor("claude-sonnet-4-6"));

  const fortySixDaysAgo = new Date(Date.now() - 46 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const pastBound = freshTable({ lastVerified: fortySixDaysAgo, staleAfterDays: 45 });
  assert.throws(() => pastBound.priceFor("claude-sonnet-4-6"), StalePricingTableError);
});

test("modelsForTier filters correctly and also fails closed on a stale table", () => {
  const table = new PricingTable({
    version: 1,
    lastVerified: new Date().toISOString().slice(0, 10),
    prices: {
      "cheap-model": { provider: "anthropic", tier: "T1", inputPerMTok: 0.8, outputPerMTok: 4 },
      "mid-model": { provider: "anthropic", tier: "T2", inputPerMTok: 3, outputPerMTok: 15 },
    },
  });
  assert.deepEqual(table.modelsForTier("T1"), ["cheap-model"]);

  const stale = freshTable({ lastVerified: "2020-01-01" });
  assert.throws(() => stale.modelsForTier("T1"), StalePricingTableError);
});
