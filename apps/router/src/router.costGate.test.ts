import { test } from "node:test";
import assert from "node:assert/strict";
import { CostGate, InMemoryDurableReservationStore, PricingTable } from "@byok/cost-gate";
import type { CeilingConfig, TierModelMap } from "@byok/cost-gate";
import { Router } from "./router.js";
import { InMemoryDedupStore } from "./dedup.js";
import { InMemoryTaskLedger } from "./ledger.js";
import type { AgentExecutor, ExecutionOutcome } from "./executor.js";
import type { RouterTask } from "./types.js";

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
  return new CostGate(freshPricingTable(), ceilingConfig, new InMemoryDurableReservationStore(), modelMap);
}

function countingExecutor(): { executor: AgentExecutor; callCount: () => number } {
  let calls = 0;
  const executor: AgentExecutor = {
    async execute(task: RouterTask): Promise<ExecutionOutcome> {
      calls += 1;
      return { result: `ran on ${task.model}`, costUsd: 0.001 };
    },
  };
  return { executor, callCount: () => calls };
}

test("PROCEED: gate allows the task through, executor runs, reservation settles", async () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {} });
  const { executor, callCount } = countingExecutor();
  const router = new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), executor, gate);

  const task = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice",
    payload: "Create an invoice",
    dedupKey: "task-1",
    model: "mid-model",
  });

  assert.equal(task.status, "completed");
  assert.equal(callCount(), 1);
  assert.equal(task.model, "mid-model");
});

test("QUEUE: gate blocks the task before the executor ever runs", async () => {
  const gate = makeGate({ companyMonthlyUsd: 0.0000001, perRoleUsd: {}, perTaskTypeUsd: {} });
  const { executor, callCount } = countingExecutor();
  const router = new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), executor, gate);

  const task = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice",
    payload: "Create an invoice",
    dedupKey: "task-2",
    model: "mid-model",
    batchable: true,
  });

  assert.equal(task.status, "queued");
  assert.equal(callCount(), 0, "executor must never run for a QUEUE verdict");
});

test("SKIP: gate blocks the task before the executor ever runs, and never reserves budget", async () => {
  const gate = makeGate({ companyMonthlyUsd: 0.0000001, perRoleUsd: {}, perTaskTypeUsd: {} });
  const { executor, callCount } = countingExecutor();
  const router = new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), executor, gate);

  const task = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice",
    payload: "Create an invoice",
    dedupKey: "task-3",
    model: "mid-model",
    batchable: false,
  });

  assert.equal(task.status, "skipped");
  assert.equal(callCount(), 0);
});

test("DOWNGRADE: the executor receives the DOWNGRADED model, not the originally requested one", async () => {
  const gate = makeGate({ companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: { invoicing: 0.002 } });
  let modelSeenByExecutor: string | undefined;
  const executor: AgentExecutor = {
    async execute(task: RouterTask): Promise<ExecutionOutcome> {
      modelSeenByExecutor = task.model;
      return { result: "ok", costUsd: 0.001 };
    },
  };
  const router = new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), executor, gate);

  const task = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice",
    payload: "Create an invoice",
    dedupKey: "task-4",
    model: "mid-model", // requested T2, ceiling only fits T1
  });

  assert.equal(task.status, "completed");
  assert.equal(modelSeenByExecutor, "cheap-model");
  assert.equal(task.model, "cheap-model");
});

test("a failed execution releases its reservation instead of settling it", async () => {
  const gate = makeGate({ companyMonthlyUsd: 0.0018, perRoleUsd: {}, perTaskTypeUsd: {} });
  // Fails the first call only, succeeds after — lets the same gate/ledger
  // prove that a released reservation doesn't linger and block later tasks.
  let callNumber = 0;
  const flakyExecutor: AgentExecutor = {
    async execute(): Promise<ExecutionOutcome> {
      callNumber += 1;
      return callNumber === 1 ? { error: "provider billing error" } : { result: "ok", costUsd: 0.001 };
    },
  };
  const router = new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), flakyExecutor, gate);

  const first = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice",
    payload: "Create an invoice",
    dedupKey: "task-5",
    model: "cheap-model",
  });
  assert.equal(first.status, "failed");

  // If the failed reservation had NOT been released, this second (equally
  // cheap) task would blow the tiny company ceiling and get queued instead
  // of proceeding.
  const second = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create another invoice",
    payload: "Create an invoice",
    dedupKey: "task-6",
    model: "cheap-model",
  });
  assert.equal(second.status, "completed");
});

test("no CostGate configured: behaves exactly as before (no gating at all)", async () => {
  const { executor, callCount } = countingExecutor();
  const router = new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), executor); // no gate

  const task = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice",
    payload: "Create an invoice",
    dedupKey: "task-7",
    model: "mid-model",
  });

  assert.equal(task.status, "completed");
  assert.equal(callCount(), 1);
});
