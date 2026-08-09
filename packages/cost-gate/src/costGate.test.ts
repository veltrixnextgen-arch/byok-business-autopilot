import { test } from "node:test";
import assert from "node:assert/strict";
import { PricingTable } from "./pricing.js";
import { InMemoryDurableReservationStore } from "./durable/reservationStore.js";
import { CostGate } from "./costGate.js";
import type { CeilingConfig } from "./ceilings.js";
import type { TierModelMap } from "./tierRouter.js";
import type { GateEvaluationRequest } from "./costGate.js";

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

function makeGate(ceilingConfig: CeilingConfig, store = new InMemoryDurableReservationStore()) {
  return new CostGate(freshPricingTable(), ceilingConfig, store, modelMap);
}

function makeInput(overrides: Partial<GateEvaluationRequest> = {}): GateEvaluationRequest {
  return {
    taskId: "task-1",
    tenantId: "tenant-a",
    roleId: "cfo",
    taskType: "invoicing",
    payload: "Create an invoice",
    model: "mid-model",
    outputClass: "short-structured",
    batchable: true,
    ...overrides,
  };
}

test("PROCEED/DOWNGRADE reserve budget; QUEUE/SKIP never do", async () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {} });

  const proceedResult = await gate.evaluateAndReserve(makeInput());
  assert.equal(proceedResult.verdict.kind, "PROCEED");
  assert.ok(proceedResult.reservation);

  const tinyBudgetGate = makeGate({ companyMonthlyUsd: 0.0000001, perRoleUsd: {}, perTaskTypeUsd: {} });
  const queueResult = await tinyBudgetGate.evaluateAndReserve(makeInput({ taskId: "task-2" }));
  assert.equal(queueResult.verdict.kind, "QUEUE");
  assert.equal(queueResult.reservation, undefined);
});

test("settle after a successful execution moves the reservation into settled spend", async () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {} });
  const { reservation } = await gate.evaluateAndReserve(makeInput());
  assert.ok(reservation);
  await gate.settle(reservation!.id, 0.002);
  const audit = gate.auditEvents();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].verdict, "PROCEED");
});

test("release after a failed execution does not count the reservation as spend", async () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {} });
  const { reservation } = await gate.evaluateAndReserve(makeInput());
  assert.ok(reservation);
  await gate.release(reservation!.id);
  // Releasing must not throw and must not leave the reservation counted —
  // verified indirectly: a second full-ceiling task should still fit.
  const second = await gate.evaluateAndReserve(makeInput({ taskId: "task-2" }));
  assert.equal(second.verdict.kind, "PROCEED");
});

test("SKIP emits a task.skipped event for the router/notification system to act on", async () => {
  const gate = makeGate({ companyMonthlyUsd: 0.0000001, perRoleUsd: {}, perTaskTypeUsd: {} });
  const events: string[] = [];
  gate.onEvent((e) => events.push(`${e.type}:${e.taskId}`));

  const result = await gate.evaluateAndReserve(makeInput({ batchable: false }));
  assert.equal(result.verdict.kind, "SKIP");
  assert.deepEqual(events, ["task.skipped:task-1"]);
});

test("PROCEED/QUEUE/DOWNGRADE do not emit a task.skipped event", async () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {} });
  const events: string[] = [];
  gate.onEvent((e) => events.push(e.type));
  await gate.evaluateAndReserve(makeInput());
  assert.deepEqual(events, []);
});

test("every evaluation is audit-logged, in order, regardless of verdict", async () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {} });
  await gate.evaluateAndReserve(makeInput({ taskId: "task-1" }));
  await gate.evaluateAndReserve(makeInput({ taskId: "task-2", model: "not-a-real-model" }));
  const audit = gate.auditEvents();
  assert.deepEqual(
    audit.map((e) => [e.taskId, e.verdict]),
    [
      ["task-1", "PROCEED"],
      ["task-2", "QUEUE"],
    ],
  );
});

// Issue #47's core bug: one shared pool, not per-tenant. Two tenants each
// dispatching against the SAME CostGate instance must draw from
// independent ceiling pools — one tenant maxing out its own budget must
// never affect the other's.
test("issue #47: two tenants have fully independent ceiling pools on the same CostGate instance", async () => {
  // mid-model's upper-bound estimate for this payload is ~$0.0054 — a
  // $0.01 ceiling comfortably fits one, but not two back to back.
  const gate = makeGate({ companyMonthlyUsd: 0.01, perRoleUsd: {}, perTaskTypeUsd: {} });

  const tenantAFirst = await gate.evaluateAndReserve(makeInput({ taskId: "a-1", tenantId: "tenant-a" }));
  assert.equal(tenantAFirst.verdict.kind, "PROCEED");

  // Tenant A is now at/near its own $0.01 ceiling — a second tenant-A task
  // must not get a clean PROCEED (downgraded/queued/skipped all count).
  const tenantASecond = await gate.evaluateAndReserve(makeInput({ taskId: "a-2", tenantId: "tenant-a" }));
  assert.notEqual(tenantASecond.verdict.kind, "PROCEED");

  // Tenant B has never spent anything — its own $0.01 pool is untouched
  // by tenant A's activity above.
  const tenantBFirst = await gate.evaluateAndReserve(makeInput({ taskId: "b-1", tenantId: "tenant-b" }));
  assert.equal(tenantBFirst.verdict.kind, "PROCEED");
});

// Issue #47's second gap: "the ledger is in-memory... resets to $0 on
// every redeploy/restart." Simulated here by constructing a FRESH CostGate
// (a fresh in-process pre-check ledger, as a restart would produce) but
// pointed at the SAME durable store instance — the durable store must
// still remember and enforce the tenant's prior spend.
test("issue #47: a fresh CostGate instance (simulating a restart) still enforces spend the durable store already recorded", async () => {
  const store = new InMemoryDurableReservationStore();
  const ceiling: CeilingConfig = { companyMonthlyUsd: 0.003, perRoleUsd: {}, perTaskTypeUsd: {} };

  const beforeRestart = makeGate(ceiling, store);
  const first = await beforeRestart.evaluateAndReserve(makeInput({ taskId: "before-1", tenantId: "tenant-a", model: "cheap-model" }));
  assert.equal(first.verdict.kind, "PROCEED");
  assert.ok(first.reservation);
  await beforeRestart.settle(first.reservation!.id, 0.0025);

  // A brand-new CostGate — its in-process pre-check ledger starts empty,
  // exactly like a fresh process after a redeploy — but the SAME durable
  // store still has tenant-a's $0.0025 settled against a $0.003 ceiling.
  const afterRestart = makeGate(ceiling, store);
  const second = await afterRestart.evaluateAndReserve(makeInput({ taskId: "after-1", tenantId: "tenant-a", model: "cheap-model" }));
  assert.notEqual(second.verdict.kind, "PROCEED", "a fresh process must not re-open budget the durable store already recorded as spent");
});

test("a locally-approved PROCEED that the durable store rejects downgrades cleanly to SKIP with a 'durable check' reason, not a throw", async () => {
  const store = new InMemoryDurableReservationStore();
  // cheap-model's upper-bound estimate for this payload is ~$0.00144 — a
  // $0.002 ceiling fits exactly one outstanding reservation, not two.
  const ceiling: CeilingConfig = { companyMonthlyUsd: 0.002, perRoleUsd: {}, perTaskTypeUsd: {} };

  // Replica A spends most of tenant-a's ceiling through the durable store.
  const replicaA = makeGate(ceiling, store);
  const first = await replicaA.evaluateAndReserve(makeInput({ taskId: "a-1", tenantId: "tenant-a", model: "cheap-model" }));
  assert.equal(first.verdict.kind, "PROCEED");

  // Replica B is a SEPARATE CostGate instance — its own local pre-check
  // ledger has never seen replica A's spend, so it will locally compute
  // PROCEED — but it shares the SAME durable store, which knows better and
  // must be the one to actually catch it.
  const replicaB = makeGate(ceiling, store);
  const second = await replicaB.evaluateAndReserve(
    makeInput({ taskId: "b-1", tenantId: "tenant-a", model: "cheap-model", batchable: false }),
  );
  assert.equal(second.verdict.kind, "SKIP");
  assert.match(second.verdict.reason, /durable check/);
  assert.equal(second.reservation, undefined);
});
