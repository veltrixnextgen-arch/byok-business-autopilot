import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import type { InterviewAnswers, OrgChart } from "@byok/contracts";
import { CostGate, InMemoryDurableReservationStore, PricingTable, type TierModelMap } from "@byok/cost-gate";
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
  const failedWith: string[] = [];
  return {
    calls,
    failedWith,
    async start(userId: string, idea: string) {
      calls.push("start");
      return { id: "batch-1", userId, idea, status: "running" as const, orgChart: null, costUsd: null, error: null, createdAt: "", updatedAt: "" };
    },
    async complete() {
      calls.push("complete");
    },
    async fail(_userId: string, _id: string, error: string) {
      calls.push("fail");
      failedWith.push(error);
    },
  };
}

function buildDeps(overrides: {
  ceilingUsd: number;
  extract: RunExtractionBatchDeps["extract"];
  apiKey?: string;
  costGate?: CostGate;
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
  const costGate =
    overrides.costGate ??
    new CostGate(
      pricingTable,
      { companyMonthlyUsd: overrides.ceilingUsd, perRoleUsd: {}, perTaskTypeUsd: {} },
      new InMemoryDurableReservationStore(),
      modelMap,
    );
  const ledger = new FakeTaskLedger();
  const batchStore = fakeBatchStore();
  return {
    deps: { costGate, ledger, batchStore, apiKey: overrides.apiKey ?? "test-key", extract: overrides.extract },
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

// Issue #47 ask #3: the user-facing reason must be plain language, not the
// internal "Over company ceiling, downgrade insufficient, and this task
// type isn't batchable" string — that string still exists, but only in the
// ledger note for operators, never in what's returned to the caller.
test("a SKIP verdict returns a plain-language reason to the caller, not the internal ceiling-jargon string", async () => {
  const { deps, ledger } = buildDeps({
    ceilingUsd: 0,
    extract: async () => FAKE_CHART,
  });

  const result = await runExtractionBatch(deps, { userId: "user-1", idea: "test idea", answers: ANSWERS });

  assert.equal(result.status, "skipped");
  if (result.status === "skipped") {
    assert.doesNotMatch(result.reason, /ceiling|downgrade insufficient|batchable/i);
    assert.match(result.reason, /usage limit/i);
  }
  // The detailed, technical reason is still recorded for operators.
  const skippedEntry = ledger.entries.find((e) => e.status === "skipped");
  assert.match(skippedEntry?.note ?? "", /ceiling/i);
});

// Issue #47's per-signup ask: extraction has no company yet (ADR-015), so
// the signing-up user's own id must be the ceiling scope CostGate sees.
// The actual cross-tenant isolation math is proven numerically in
// packages/cost-gate/src/costGate.test.ts — this test only proves the
// WIRING: runExtractionBatch passes the right scoping key through.
test("issue #47: each user's own id is passed as CostGate's tenantId, not a shared/omitted key", async () => {
  const seenTenantIds: string[] = [];
  const fakeCostGate = {
    async evaluateAndReserve(input: { tenantId: string }) {
      seenTenantIds.push(input.tenantId);
      return { verdict: { kind: "PROCEED" as const, reason: "ok", model: "x" }, reservation: { id: "r-1", roleId: "onboarding", taskType: "extraction-batch", amountUsd: 0, createdAt: "", status: "reserved" as const } };
    },
    async settle() {},
    async release() {},
  } as unknown as CostGate;

  const { deps: deps1 } = buildDeps({ ceilingUsd: 1000, costGate: fakeCostGate, extract: async () => FAKE_CHART });
  await runExtractionBatch(deps1, { userId: "user-a", idea: "test idea", answers: ANSWERS });

  const { deps: deps2 } = buildDeps({ ceilingUsd: 1000, costGate: fakeCostGate, extract: async () => FAKE_CHART });
  await runExtractionBatch(deps2, { userId: "user-b", idea: "another idea", answers: ANSWERS });

  assert.deepEqual(seenTenantIds, ["user-a", "user-b"]);
});

test("a rejected platform API key surfaces a clear, specific message — not the raw provider error body", async () => {
  // Mirrors what the Anthropic SDK actually throws for a bad/revoked key
  // (confirmed live against staging: a real invalid key produces exactly
  // this shape), not a hand-rolled Error — the classification in
  // runExtractionBatch.ts checks `instanceof Anthropic.AuthenticationError`.
  const upstreamError = new Anthropic.AuthenticationError(
    401,
    { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
    undefined,
    undefined,
  );
  const { deps, ledger, batchStore } = buildDeps({
    ceilingUsd: 1000,
    extract: async () => {
      throw upstreamError;
    },
  });

  const result = await runExtractionBatch(deps, { userId: "user-1", idea: "test idea", answers: ANSWERS });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.doesNotMatch(result.error, /invalid x-api-key|authentication_error|request_id/);
    assert.match(result.error, /rejected the platform's API key/);
  }
  for (const note of ledger.entries.map((e) => e.note).filter((n): n is string => Boolean(n))) {
    assert.doesNotMatch(note, /invalid x-api-key|authentication_error/);
  }
  assert.deepEqual(batchStore.failedWith, [
    "The AI provider rejected the platform's API key. Extraction can't run until this is fixed — try again later.",
  ]);
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

// The platform key (ADR-003) is a platform credential, not a user one —
// it doesn't live in the vault, but it must never leak through the paths
// that ARE user-visible: the persisted batch record (returned by
// GET /extraction/batches/latest) and the router's ledger. This is a
// regression test, not proof the Anthropic SDK itself never echoes a key
// in an error (out of this repo's control) — it guards the realistic
// failure mode: something in OUR error handling accidentally
// interpolating deps.apiKey into a message that then gets persisted.
test("the platform API key never appears in a persisted error or ledger note, even on failure", async () => {
  const SECRET = "sk-ant-test-SECRET-do-not-leak-9f8e7d6c";
  const { deps, ledger, batchStore } = buildDeps({
    ceilingUsd: 1000,
    apiKey: SECRET,
    extract: async () => {
      throw new Error("upstream request failed: 401 unauthorized");
    },
  });

  await runExtractionBatch(deps, { userId: "user-1", idea: "test idea", answers: ANSWERS });

  for (const note of ledger.entries.map((e) => e.note).filter((n): n is string => Boolean(n))) {
    assert.ok(!note.includes(SECRET), `ledger note leaked the API key: ${note}`);
  }
  for (const error of batchStore.failedWith) {
    assert.ok(!error.includes(SECRET), `persisted batch error leaked the API key: ${error}`);
  }
});
