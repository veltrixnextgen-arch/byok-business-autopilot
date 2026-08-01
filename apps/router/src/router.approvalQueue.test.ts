import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalQueue, AutonomyEngine, MockEffectExecutor } from "@byok/approval-queue";
import { Router, ProductionRouterGuardError } from "./router.js";
import { InMemoryDedupStore } from "./dedup.js";
import { InMemoryTaskLedger } from "./ledger.js";
import type { AgentExecutor, ExecutionOutcome } from "./executor.js";
import type { RouterTask } from "./types.js";

function alwaysCompletesExecutor(): AgentExecutor {
  return {
    async execute(task: RouterTask): Promise<ExecutionOutcome> {
      return { result: `drafted output for ${task.title}` };
    },
  };
}

test("executor success routes through the approval queue: pending review, not immediately 'completed'", async () => {
  const queue = new ApprovalQueue(new AutonomyEngine(), new MockEffectExecutor());
  const router = new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), alwaysCompletesExecutor(), undefined, queue);

  const task = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Draft an invoice",
    payload: "...",
    dedupKey: "task-1",
  });

  assert.equal(task.status, "awaiting_review");
  assert.equal(task.result, "drafted output for Draft an invoice");
  assert.equal(queue.pendingActions().length, 1);
});

test("resolving the queued action with APPROVE does not change RouterTask status retroactively (async decoupling), but dispatches the effect", async () => {
  let dispatched = false;
  const effectExecutor = { async execute() { dispatched = true; return { success: true as const }; } };
  const queue = new ApprovalQueue(new AutonomyEngine(), effectExecutor);
  const router = new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), alwaysCompletesExecutor(), undefined, queue);

  const task = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Send an invoice",
    payload: "...",
    dedupKey: "task-2",
    effect: { kind: "send", description: "Email the invoice to the client" },
  });

  assert.equal(task.status, "awaiting_review");
  assert.equal(dispatched, false, "effect must not dispatch before a human approves");

  const result = await queue.resolve(task.id, { kind: "APPROVE" });
  assert.equal(result.dispatched, true);
  assert.equal(dispatched, true);
});

test("earned autonomy bypass: task completes immediately, no queue entry, effect dispatches", async () => {
  let dispatched = false;
  const effectExecutor = { async execute() { dispatched = true; return { success: true as const }; } };
  const autonomy = new AutonomyEngine({ offerThreshold: 1, spotCheckRate: 0 }, () => 1); // never spot-check
  const queue = new ApprovalQueue(autonomy, effectExecutor);
  const router = new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), alwaysCompletesExecutor(), undefined, queue);

  // Earn autonomy for "invoicing" via a normal reviewed approval first.
  const first = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Draft invoice #1",
    payload: "...",
    dedupKey: "task-3",
  });
  await queue.resolve(first.id, { kind: "APPROVE" });
  autonomy.acceptOffer("default", "invoicing");

  const second = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Draft invoice #2",
    payload: "...",
    dedupKey: "task-4",
    effect: { kind: "send", description: "Email the invoice" },
  });

  assert.equal(second.status, "completed");
  assert.equal(queue.pendingActions().length, 0);
  assert.equal(dispatched, true);
});

test("tenantId defaults to 'default' and flows through to the queue's autonomy tracking", async () => {
  const queue = new ApprovalQueue(new AutonomyEngine(), new MockEffectExecutor());
  const router = new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), alwaysCompletesExecutor(), undefined, queue);

  const task = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Draft invoice",
    payload: "...",
    dedupKey: "task-5",
  });

  assert.equal(task.tenantId, "default");
  const [action] = queue.pendingActions();
  assert.equal(action.tenantId, "default");
});

test("a failed execution never reaches the approval queue", async () => {
  const queue = new ApprovalQueue(new AutonomyEngine(), new MockEffectExecutor());
  const failingExecutor: AgentExecutor = { async execute() { return { error: "boom" }; } };
  const router = new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), failingExecutor, undefined, queue);

  const task = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Draft invoice",
    payload: "...",
    dedupKey: "task-6",
  });

  assert.equal(task.status, "failed");
  assert.equal(queue.pendingActions().length, 0);
});

test("ADR-008: production refuses to construct a Router missing either CostGate or ApprovalQueue", () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(
      () => new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), alwaysCompletesExecutor()),
      ProductionRouterGuardError,
    );
    assert.throws(
      () =>
        new Router(
          new InMemoryTaskLedger(),
          new InMemoryDedupStore(),
          alwaysCompletesExecutor(),
          undefined,
          new ApprovalQueue(new AutonomyEngine(), new MockEffectExecutor()),
        ),
      ProductionRouterGuardError,
      "missing CostGate alone must still fail",
    );
  } finally {
    process.env.NODE_ENV = original;
  }
});

test("ADR-008: dev/test environments are unaffected — a Router with neither dependency still constructs fine outside production", () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "test";
    assert.doesNotThrow(() => new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), alwaysCompletesExecutor()));
  } finally {
    process.env.NODE_ENV = original;
  }
});
