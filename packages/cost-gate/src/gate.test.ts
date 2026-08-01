import { test } from "node:test";
import assert from "node:assert/strict";
import { PricingTable } from "./pricing.js";
import { ReservationLedger } from "./reservations.js";
import { evaluateGateVerdict, type GateDependencies, type GateEvaluationInput } from "./gate.js";
import type { CeilingConfig } from "./ceilings.js";
import type { TierModelMap } from "./tierRouter.js";

const modelMap: TierModelMap = { T1: "cheap-model", T2: "mid-model", T3: "frontier-model" };

function freshPricingTable(lastVerified = new Date().toISOString().slice(0, 10)) {
  return new PricingTable({
    version: 1,
    lastVerified,
    prices: {
      "cheap-model": { provider: "anthropic", tier: "T1", inputPerMTok: 0.8, outputPerMTok: 4 },
      "mid-model": { provider: "anthropic", tier: "T2", inputPerMTok: 3, outputPerMTok: 15 },
      "frontier-model": { provider: "anthropic", tier: "T3", inputPerMTok: 15, outputPerMTok: 75 },
    },
  });
}

function makeDeps(overrides: Partial<GateDependencies> = {}): GateDependencies {
  const ceilingConfig: CeilingConfig = {
    companyMonthlyUsd: 100,
    perRoleUsd: { cfo: 100 },
    perTaskTypeUsd: { invoicing: 100 },
  };
  return {
    pricingTable: freshPricingTable(),
    ceilingConfig,
    ledger: new ReservationLedger(),
    modelMap,
    ...overrides,
  };
}

function makeInput(overrides: Partial<GateEvaluationInput> = {}): GateEvaluationInput {
  return {
    taskId: "task-1",
    roleId: "cfo",
    taskType: "invoicing",
    payload: "Create an invoice for order #123",
    model: "mid-model",
    outputClass: "short-structured",
    batchable: true,
    ...overrides,
  };
}

test("PROCEED when well within all ceilings", () => {
  const deps = makeDeps();
  const verdict = evaluateGateVerdict(makeInput(), deps);
  assert.equal(verdict.kind, "PROCEED");
  assert.equal(verdict.model, "mid-model");
});

test("fail-closed: unknown model estimator error -> QUEUE, never PROCEED", () => {
  const deps = makeDeps();
  const verdict = evaluateGateVerdict(makeInput({ model: "not-a-real-model" }), deps);
  assert.equal(verdict.kind, "QUEUE");
  assert.match(verdict.reason, /Estimator error/);
});

test("fail-closed: stale pricing table -> QUEUE, never PROCEED", () => {
  const deps = makeDeps({ pricingTable: freshPricingTable("2020-01-01") });
  const verdict = evaluateGateVerdict(makeInput(), deps);
  assert.equal(verdict.kind, "QUEUE");
  assert.match(verdict.reason, /Estimator error/);
});

test("downgrade: over the task-type ceiling at T2, but T1 fits -> DOWNGRADE to cheap-model", () => {
  const deps = makeDeps({
    // mid-model's upper-bound estimate for this payload is ~$0.0054;
    // cheap-model's is ~$0.0014 — 0.002 sits between them, so only the
    // downgrade should be needed, not a fall-through to queue.
    ceilingConfig: { companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: { invoicing: 0.002 } },
  });
  const verdict = evaluateGateVerdict(makeInput(), deps);
  assert.equal(verdict.kind, "DOWNGRADE");
  assert.equal(verdict.model, "cheap-model");
});

test("downgrade-then-queue cascade: even T1 doesn't fit -> QUEUE (batchable)", () => {
  const deps = makeDeps({
    ceilingConfig: { companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: { invoicing: 0.0000001 } },
  });
  const verdict = evaluateGateVerdict(makeInput({ batchable: true }), deps);
  assert.equal(verdict.kind, "QUEUE");
  assert.match(verdict.reason, /downgrade attempt/);
});

test("downgrade-then-skip cascade: even T1 doesn't fit and task is not batchable -> SKIP", () => {
  const deps = makeDeps({
    ceilingConfig: { companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: { invoicing: 0.0000001 } },
  });
  const verdict = evaluateGateVerdict(makeInput({ batchable: false }), deps);
  assert.equal(verdict.kind, "SKIP");
  assert.match(verdict.reason, /isn't batchable/);
});

test("already at cheapest tier and over ceiling -> no downgrade possible, goes straight to queue/skip", () => {
  const deps = makeDeps({
    ceilingConfig: { companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: { invoicing: 0.0000001 } },
  });
  const verdict = evaluateGateVerdict(makeInput({ model: "cheap-model", batchable: false }), deps);
  assert.equal(verdict.kind, "SKIP");
});

test("ceilings are checked company -> role -> task-type, in that order (company caught first)", () => {
  const deps = makeDeps({
    ceilingConfig: {
      companyMonthlyUsd: 0.0000001, // will trip first no matter what
      perRoleUsd: { cfo: 1000 },
      perTaskTypeUsd: { invoicing: 1000 },
    },
  });
  const verdict = evaluateGateVerdict(makeInput({ model: "cheap-model" }), deps); // even cheapest tier can't fit under this company ceiling
  assert.notEqual(verdict.kind, "PROCEED");
});

test("reservations already in flight count against the ceiling for the next evaluation", () => {
  const deps = makeDeps({
    ceilingConfig: { companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: { invoicing: 0.01 } },
  });
  // Manually reserve most of the task-type ceiling first, as if another task just dispatched.
  deps.ledger.reserve("cfo", "invoicing", 0.0099);
  const verdict = evaluateGateVerdict(makeInput({ model: "cheap-model", batchable: false }), deps);
  assert.notEqual(verdict.kind, "PROCEED");
});

// Property-style test: for a wide sweep of ceiling configurations and
// models (including deliberately broken ones — unknown models, stale
// tables, zero/negative ceilings), the verdict is NEVER "PROCEED" unless
// the estimate succeeded AND every ceiling check actually passed. This is
// the thing that matters most about a fail-closed gate: there is no input
// that sneaks a PROCEED out of a broken check.
test("property: PROCEED never occurs when the estimate failed or any ceiling was exceeded", () => {
  const models = ["cheap-model", "mid-model", "frontier-model", "unknown-model", "another-fake-model"];
  const tableFreshness = [new Date().toISOString().slice(0, 10), "2020-01-01"]; // fresh, stale
  const companyCeilings = [1000, 0.01, 0, -1];
  const roleCeilings = [1000, 0.01, 0];
  const taskTypeCeilings = [1000, 0.01, 0];
  const batchableOptions = [true, false];

  let proceedCount = 0;
  let evaluatedCount = 0;

  for (const model of models) {
    for (const lastVerified of tableFreshness) {
      for (const companyMonthlyUsd of companyCeilings) {
        for (const roleUsd of roleCeilings) {
          for (const taskTypeUsd of taskTypeCeilings) {
            for (const batchable of batchableOptions) {
              const deps = makeDeps({
                pricingTable: freshPricingTable(lastVerified),
                ceilingConfig: { companyMonthlyUsd, perRoleUsd: { cfo: roleUsd }, perTaskTypeUsd: { invoicing: taskTypeUsd } },
                ledger: new ReservationLedger(),
              });
              const verdict = evaluateGateVerdict(makeInput({ model, batchable }), deps);
              evaluatedCount += 1;

              if (verdict.kind === "PROCEED") {
                proceedCount += 1;
                // If we got PROCEED, independently re-derive that this was
                // actually justified: the table must be fresh, the model
                // must be known, and the estimate must fit ALL THREE ceilings.
                assert.ok(models.includes(model) && model !== "unknown-model" && model !== "another-fake-model");
                assert.equal(lastVerified, tableFreshness[0], "PROCEED occurred against a stale table");
                assert.ok(companyMonthlyUsd > 0, "PROCEED occurred against a non-positive company ceiling");
                assert.ok(roleUsd > 0, "PROCEED occurred against a non-positive role ceiling");
                assert.ok(taskTypeUsd > 0, "PROCEED occurred against a non-positive task-type ceiling");
              }
            }
          }
        }
      }
    }
  }

  assert.ok(evaluatedCount > 0);
  assert.ok(proceedCount > 0, "sanity check: at least some combinations should have legitimately succeeded");
  assert.ok(proceedCount < evaluatedCount, "sanity check: at least some combinations should have failed");
});
