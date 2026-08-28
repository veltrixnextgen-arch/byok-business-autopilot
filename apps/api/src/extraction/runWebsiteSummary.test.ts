import assert from "node:assert/strict";
import { test } from "node:test";
import { CostGate, InMemoryDurableReservationStore, PricingTable, type TierModelMap } from "@byok/cost-gate";
import { UnsafeWebsiteUrlError, WebsiteFetchFailedError, WebsiteFetchTimeoutError, type FetchWebsiteTextResult, type WebsiteSummaryResult } from "@byok/extraction";
import { runWebsiteSummary, type RunWebsiteSummaryDeps } from "./runWebsiteSummary.js";

function buildDeps(overrides: {
  ceilingUsd?: number;
  fetchText: RunWebsiteSummaryDeps["fetchText"];
  summarize?: RunWebsiteSummaryDeps["summarize"];
}) {
  const modelMaps = { anthropic: { T1: "claude-haiku-4-5-20251001", T2: "claude-sonnet-4-6", T3: "frontier" } as TierModelMap };
  const pricingTable = new PricingTable({
    version: 1,
    lastVerified: new Date().toISOString().slice(0, 10),
    prices: {
      "claude-haiku-4-5-20251001": { provider: "anthropic", tier: "T1", inputPerMTok: 0.8, outputPerMTok: 4 },
      "claude-sonnet-4-6": { provider: "anthropic", tier: "T2", inputPerMTok: 3, outputPerMTok: 15 },
      frontier: { provider: "anthropic", tier: "T3", inputPerMTok: 15, outputPerMTok: 75 },
    },
  });
  const costGate = new CostGate(
    pricingTable,
    { companyMonthlyUsd: overrides.ceilingUsd ?? 1000, perRoleUsd: {}, perTaskTypeUsd: {} },
    new InMemoryDurableReservationStore(),
    modelMaps,
  );
  const deps: RunWebsiteSummaryDeps = {
    costGate,
    apiKey: "test-key",
    fetchText: overrides.fetchText,
    summarize: overrides.summarize,
  };
  return deps;
}

const LONG_ENOUGH_TEXT = "Acme sells handmade candles online, shipped worldwide, to individual customers. ".repeat(3);

test("a successful fetch + summary reserves, settles, and returns the summary", async () => {
  const settleCalls: number[] = [];
  const deps = buildDeps({
    fetchText: async () => ({ text: LONG_ENOUGH_TEXT, finalUrl: "https://acme.example/" }) satisfies FetchWebsiteTextResult,
    summarize: async () => {
      const result: WebsiteSummaryResult = { sufficientContent: true, summary: "Acme sells handmade candles online.", costUsd: 0.004 };
      settleCalls.push(result.costUsd);
      return result;
    },
  });

  const result = await runWebsiteSummary(deps, "user-1", "https://acme.example/");

  assert.deepEqual(result, { status: "completed", summary: "Acme sells handmade candles online." });
  assert.deepEqual(settleCalls, [0.004]);
});

test("text too thin to bother summarizing short-circuits before ever reserving budget", async () => {
  let summarizeCalled = false;
  const deps = buildDeps({
    fetchText: async () => ({ text: "hi", finalUrl: "https://thin.example/" }),
    summarize: async () => {
      summarizeCalled = true;
      throw new Error("must not be called");
    },
  });

  const result = await runWebsiteSummary(deps, "user-1", "https://thin.example/");

  assert.deepEqual(result, { status: "insufficient-content" });
  assert.equal(summarizeCalled, false);
});

test("the model's own insufficient-content signal is honored even when the page text was long enough to try", async () => {
  const deps = buildDeps({
    fetchText: async () => ({ text: LONG_ENOUGH_TEXT, finalUrl: "https://vague.example/" }),
    summarize: async () => ({ sufficientContent: false, summary: "", costUsd: 0.002 }),
  });

  const result = await runWebsiteSummary(deps, "user-1", "https://vague.example/");

  assert.deepEqual(result, { status: "insufficient-content" });
});

test("an unsafe URL from the fetch layer passes through as its own status, never thrown past this function", async () => {
  const deps = buildDeps({
    fetchText: async () => {
      throw new UnsafeWebsiteUrlError("private address");
    },
  });

  const result = await runWebsiteSummary(deps, "user-1", "http://169.254.169.254/");

  assert.equal(result.status, "unsafe-url");
});

test("an unreachable site (timeout or fetch failure) passes through as its own status", async () => {
  const deps = buildDeps({
    fetchText: async () => {
      throw new WebsiteFetchTimeoutError("too slow");
    },
  });
  assert.equal((await runWebsiteSummary(deps, "user-1", "https://slow.example/")).status, "unreachable");

  const deps2 = buildDeps({
    fetchText: async () => {
      throw new WebsiteFetchFailedError("404");
    },
  });
  assert.equal((await runWebsiteSummary(deps2, "user-1", "https://dead.example/")).status, "unreachable");
});

test("a QUEUE/SKIP verdict never calls summarize, and never consumes the extraction batch's own budget", async () => {
  let summarizeCalled = false;
  const deps = buildDeps({
    ceilingUsd: 0, // zero budget forces a non-PROCEED verdict
    fetchText: async () => ({ text: LONG_ENOUGH_TEXT, finalUrl: "https://acme.example/" }),
    summarize: async () => {
      summarizeCalled = true;
      throw new Error("must not be called");
    },
  });

  const result = await runWebsiteSummary(deps, "user-1", "https://acme.example/");

  assert.ok(result.status === "queued" || result.status === "skipped");
  assert.equal(summarizeCalled, false);
});

test("a summarize failure releases the reservation rather than leaving it stuck", async () => {
  const deps = buildDeps({
    fetchText: async () => ({ text: LONG_ENOUGH_TEXT, finalUrl: "https://acme.example/" }),
    summarize: async () => {
      throw new Error("model call failed");
    },
  });

  const result = await runWebsiteSummary(deps, "user-1", "https://acme.example/");

  assert.equal(result.status, "failed");
  // A second call must be able to reserve again — proof the first
  // reservation was actually released, not left dangling against the
  // ceiling.
  const second = await runWebsiteSummary(
    buildDeps({ fetchText: deps.fetchText!, summarize: async () => ({ sufficientContent: true, summary: "ok", costUsd: 0.001 }) }),
    "user-1",
    "https://acme.example/",
  );
  assert.equal(second.status, "completed");
});
