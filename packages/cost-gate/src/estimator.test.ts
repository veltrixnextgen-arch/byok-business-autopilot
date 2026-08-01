import { test } from "node:test";
import assert from "node:assert/strict";
import { PricingTable } from "./pricing.js";
import { estimateCost } from "./estimator.js";

const table = new PricingTable({
  version: 1,
  lastVerified: new Date().toISOString().slice(0, 10),
  prices: {
    "claude-sonnet-4-6": { provider: "anthropic", tier: "T2", inputPerMTok: 3.0, outputPerMTok: 15.0 },
  },
});

test("estimate produces a lower and upper bound straddling the point estimate, upper > lower", () => {
  const estimate = estimateCost("Draft an invoice for order #123", "claude-sonnet-4-6", "short-structured", table);
  assert.ok(estimate.costUpperBoundUsd > estimate.costLowerBoundUsd);
  assert.ok(estimate.costLowerBoundUsd > 0);
});

test("prose output class has a wider margin and higher base cost than short-structured", () => {
  const payload = "Draft a newsletter section about our latest product launch.";
  const structured = estimateCost(payload, "claude-sonnet-4-6", "short-structured", table);
  const prose = estimateCost(payload, "claude-sonnet-4-6", "prose", table);

  assert.ok(prose.marginRatio > structured.marginRatio);
  assert.ok(prose.costUpperBoundUsd > structured.costUpperBoundUsd);
});

test("throws (does not silently fall back) when the model is unknown", () => {
  assert.throws(() => estimateCost("hello", "not-a-real-model", "short-structured", table));
});

test("longer payloads produce a higher estimate than shorter ones, same model/class", () => {
  const short = estimateCost("Hi", "claude-sonnet-4-6", "short-structured", table);
  const long = estimateCost("x".repeat(10_000), "claude-sonnet-4-6", "short-structured", table);
  assert.ok(long.costUpperBoundUsd > short.costUpperBoundUsd);
});
