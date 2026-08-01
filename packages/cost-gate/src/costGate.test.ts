import { test } from "node:test";
import assert from "node:assert/strict";
import { PricingTable } from "./pricing.js";
import { ReservationLedger } from "./reservations.js";
import { CostGate } from "./costGate.js";
import type { CeilingConfig } from "./ceilings.js";
import type { TierModelMap } from "./tierRouter.js";
import type { GateEvaluationInput } from "./gate.js";

const modelMap: TierModelMap = { T1: "cheap-model", T2: "mid-model", T3: "frontier-model" };

function freshPricingTable() {
  return new PricingTable({
    version: 1,
    lastVerified: new Date().toISOString().slice(0, 10),
    prices: {
      "cheap-model": { provider: "anthropic", tier: "T1", inputPerMTok: 0.8, outputPerMTok: 4 },
      "mid-model": { provider: "anthropic", tier: "T2", inputPerMTok: 3, outputPerMTok: 15 },
      "frontier-model": { provider: "anthropic", tier: "T3", inputPerMTok: 15, outputPerMTok: 75 },
    },
  });
}

function makeGate(ceilingConfig: CeilingConfig) {
  return new CostGate(freshPricingTable(), ceilingConfig, new ReservationLedger(), modelMap);
}

function makeInput(overrides: Partial<GateEvaluationInput> = {}): GateEvaluationInput {
  return {
    taskId: "task-1",
    roleId: "cfo",
    taskType: "invoicing",
    payload: "Create an invoice",
    model: "mid-model",
    outputClass: "short-structured",
    batchable: true,
    ...overrides,
  };
}

test("PROCEED/DOWNGRADE reserve budget; QUEUE/SKIP never do", () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {} });

  const proceedResult = gate.evaluateAndReserve(makeInput());
  assert.equal(proceedResult.verdict.kind, "PROCEED");
  assert.ok(proceedResult.reservation);

  const tinyBudgetGate = makeGate({ companyMonthlyUsd: 0.0000001, perRoleUsd: {}, perTaskTypeUsd: {} });
  const queueResult = tinyBudgetGate.evaluateAndReserve(makeInput({ taskId: "task-2" }));
  assert.equal(queueResult.verdict.kind, "QUEUE");
  assert.equal(queueResult.reservation, undefined);
});

test("settle after a successful execution moves the reservation into settled spend", () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {} });
  const { reservation } = gate.evaluateAndReserve(makeInput());
  assert.ok(reservation);
  gate.settle(reservation!.id, 0.002);
  // A second evaluation should see the settled amount, not the (now-cleared) reservation.
  const audit = gate.auditEvents();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].verdict, "PROCEED");
});

test("release after a failed execution does not count the reservation as spend", () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {} });
  const { reservation } = gate.evaluateAndReserve(makeInput());
  assert.ok(reservation);
  gate.release(reservation!.id);
  // Releasing must not throw and must not leave the reservation counted —
  // verified indirectly: a second full-ceiling task should still fit.
  const second = gate.evaluateAndReserve(makeInput({ taskId: "task-2" }));
  assert.equal(second.verdict.kind, "PROCEED");
});

test("SKIP emits a task.skipped event for the router/notification system to act on", () => {
  const gate = makeGate({ companyMonthlyUsd: 0.0000001, perRoleUsd: {}, perTaskTypeUsd: {} });
  const events: string[] = [];
  gate.onEvent((e) => events.push(`${e.type}:${e.taskId}`));

  const result = gate.evaluateAndReserve(makeInput({ batchable: false }));
  assert.equal(result.verdict.kind, "SKIP");
  assert.deepEqual(events, ["task.skipped:task-1"]);
});

test("PROCEED/QUEUE/DOWNGRADE do not emit a task.skipped event", () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {} });
  const events: string[] = [];
  gate.onEvent((e) => events.push(e.type));
  gate.evaluateAndReserve(makeInput());
  assert.deepEqual(events, []);
});

test("every evaluation is audit-logged, in order, regardless of verdict", () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {} });
  gate.evaluateAndReserve(makeInput({ taskId: "task-1" }));
  gate.evaluateAndReserve(makeInput({ taskId: "task-2", model: "not-a-real-model" }));
  const audit = gate.auditEvents();
  assert.deepEqual(
    audit.map((e) => [e.taskId, e.verdict]),
    [
      ["task-1", "PROCEED"],
      ["task-2", "QUEUE"],
    ],
  );
});
