import assert from "node:assert/strict";
import { test } from "node:test";
import type { InterviewAnswers, OrgChart } from "@byok/contracts";
import { CostGate, PricingTable, ReservationLedger, type TierModelMap } from "@byok/cost-gate";
import type { LedgerEntry, TaskLedger } from "@byok/router";
import { runExtractionBatch, type RunExtractionBatchDeps } from "./runExtractionBatch.js";

const ANSWERS: InterviewAnswers = {
  whatCustomersPayFor: "test",
  whoTheCustomerIs: "consumers",
  howMoneyArrives: "one-time",
  howDeliveryReaches: "online",
  jurisdiction: { country: "US" },
  stage: "nothing-yet",
  whoIsWorkingOnIt: "solo",
  branchAnswers: {},
};

const FAKE_CHART: OrgChart = {
  meta: {
    idea: "test idea",
    generatedAt: new Date().toISOString(),
    templateSelection: {
      primary: "service",
      blendedWith: null,
      scores: { ecommerce: 0, service: 5, saas: 0, content: 0, local: 0, "physical-space": 0 },
      tie: false,
    },
    calls: [],
    costUsd: 0.03,
  },
  teams: [],
  agents: [],
  tasks: [],
  customization: { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] },
  onboardingBatch: null,
};

class FakeTaskLedger implements TaskLedger {
  entries: LedgerEntry[] = [];
  append(entry: LedgerEntry): void {
    this.entries.push(entry);
  }
  entriesFor(subAgentId: string) {
    return this.entries.filter((e) => e.subAgentId === subAgentId);
  }
  allEntries() {
    return this.entries;
  }
}

function fakeBatchStore() {
  const calls: string[] = [];
  return {
    calls,
    async start(userId: string, idea: string) {
      calls.push("start");
      return { id: "batch-1", userId, idea, status: "running" as const, orgChart: null, costUsd: null, error: null, createdAt: "", updatedAt: "" };
    },
    async complete() {
      calls.push("complete");
    },
    async fail() {
      calls.push("fail");
    },
  };
}

function buildDeps(overrides: {
  ceilingUsd: number;
  extract: RunExtractionBatchDeps["extract"];
}): { deps: RunExtractionBatchDeps; ledger: FakeTaskLedger; batchStore: ReturnType<typeof fakeBatchStore> } {
  const modelMap: TierModelMap = { T1: "cheap", T2: "claude-sonnet-4-6", T3: "frontier" };
  const pricingTable = new PricingTable({
    version: 1,
    lastVerified: new Date().toISOString().slice(0, 10),
    prices: {
      cheap: { provider: "anthropic", tier: "T1", inputPerMTok: 0.8, outputPerMTok: 4 },
      "claude-sonnet-4-6": { provider: "anthropic", tier: "T2", inputPerMTok: 3, outputPerMTok: 15 },
      frontier: { provider: "anthropic", tier: "T3", inputPerMTok: 15, outputPerMTok: 75 },
    },
  });
  const costGate = new CostGate(
    pricingTable,
    { companyMonthlyUsd: overrides.ceilingUsd, perRoleUsd: {}, perTaskTypeUsd: {} },
    new ReservationLedger(),
    modelMap,
  );
  const ledger = new FakeTaskLedger();
  const batchStore = fakeBatchStore();
  return {
    deps: { costGate, ledger, batchStore, apiKey: "test-key", extract: overrides.extract },
    ledger,
    batchStore,
  };
}

test("a successful batch reserves, settles with the real cost, persists, and ledgers pending->in_progress->completed", async () => {
  const { deps, ledger, batchStore } = buildDeps({
    ceilingUsd: 1000,
    extract: async () => FAKE_CHART,
  });

  const result = await runExtractionBatch(deps, { userId: "user-1", idea: "test idea", answers: ANSWERS });

  assert.equal(result.status, "completed");
  assert.deepEqual(
    ledger.entries.map((e) => e.status),
    ["pending", "in_progress", "completed"],
  );
  assert.deepEqual(batchStore.calls, ["start", "complete"]);
});

test("a QUEUE/SKIP verdict never calls extract and marks the batch failed with the reason", async () => {
  let extractCalled = false;
  const { deps, ledger, batchStore } = buildDeps({
    ceilingUsd: 0, // zero budget forces a non-PROCEED verdict
    extract: async () => {
      extractCalled = true;
      return FAKE_CHART;
    },
  });

  const result = await runExtractionBatch(deps, { userId: "user-1", idea: "test idea", answers: ANSWERS });

  assert.ok(result.status === "queued" || result.status === "skipped");
  assert.equal(extractCalled, false);
  assert.deepEqual(batchStore.calls, ["start", "fail"]);
  assert.ok(ledger.entries.some((e) => e.status === "queued" || e.status === "skipped"));
});

test("an extraction failure releases the reservation and marks the batch failed", async () => {
  const { deps, ledger, batchStore } = buildDeps({
    ceilingUsd: 1000,
    extract: async () => {
      throw new Error("boom");
    },
  });

  const result = await runExtractionBatch(deps, { userId: "user-1", idea: "test idea", answers: ANSWERS });

  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.match(result.error, /boom/);
  assert.deepEqual(
    ledger.entries.map((e) => e.status),
    ["pending", "in_progress", "failed"],
  );
  assert.deepEqual(batchStore.calls, ["start", "fail"]);
});
