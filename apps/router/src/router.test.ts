import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "./router.js";
import { InMemoryDedupStore } from "./dedup.js";
import { InMemoryTaskLedger } from "./ledger.js";
import { MockExecutor } from "./executor.js";
import { deriveTags } from "./tagging.js";
import type { AgentExecutor, ExecutionOutcome } from "./executor.js";
import type { RouterTask } from "./types.js";

function makeRouter(executor: AgentExecutor = new MockExecutor()) {
  return new Router(new InMemoryTaskLedger(), new InMemoryDedupStore(), executor);
}

test("tagging: derives operational tags from hints", () => {
  const tags = deriveTags({ stakes: "high", autonomy: "locked", frequency: "daily", requiresProfessionalVerification: true });
  assert.deepEqual(tags, ["high-stakes", "high-volume", "never-autonomous", "requires-professional-verification"]);
});

test("tagging: merges explicit tags with derived ones, deduped", () => {
  const tags = deriveTags({ stakes: "high" }, ["high-stakes", "custom-tag"]);
  assert.deepEqual(tags, ["custom-tag", "high-stakes"]);
});

test("task-object handoff: submitting a task executes it and returns a completed result", async () => {
  const router = makeRouter();
  const task = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice",
    payload: "Create an invoice for order #123",
    dedupKey: "invoice-123",
  });

  assert.equal(task.status, "completed");
  assert.match(task.result!, /invoicing/);
  assert.equal(task.subAgentId, "invoicing");
});

test("dedup: resubmitting the same dedupKey returns the existing task without re-executing", async () => {
  let calls = 0;
  const countingExecutor: AgentExecutor = {
    async execute(task: RouterTask): Promise<ExecutionOutcome> {
      calls += 1;
      return { result: `run ${calls} for ${task.id}` };
    },
  };
  const router = makeRouter(countingExecutor);

  const first = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice",
    payload: "Create an invoice for order #456",
    dedupKey: "invoice-456",
  });
  const second = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice (resubmitted)",
    payload: "Create an invoice for order #456",
    dedupKey: "invoice-456",
  });

  assert.equal(calls, 1, "executor should only run once for a repeated dedupKey");
  assert.equal(first.id, second.id);
  assert.equal(second.result, first.result);
});

test("per-sub-agent ledger: records pending -> in_progress -> completed for the right sub-agent, not others", async () => {
  const router = makeRouter();
  await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice",
    payload: "...",
    dedupKey: "ledger-test-1",
  });
  await router.submitTask({
    subAgentId: "tier1-triage",
    teamId: "support",
    title: "Reply to customer",
    payload: "...",
    dedupKey: "ledger-test-2",
  });

  const invoicingEntries = router.ledgerFor("invoicing");
  assert.deepEqual(
    invoicingEntries.map((e) => e.status),
    ["pending", "in_progress", "completed"],
  );
  assert.ok(invoicingEntries.every((e) => e.subAgentId === "invoicing"));

  const triageEntries = router.ledgerFor("tier1-triage");
  assert.equal(triageEntries.length, 3);
  assert.ok(triageEntries.every((e) => e.subAgentId === "tier1-triage"));
});

test("failed execution is recorded as failed in both the task and the ledger", async () => {
  const failingExecutor: AgentExecutor = {
    async execute(): Promise<ExecutionOutcome> {
      return { error: "provider billing error" };
    },
  };
  const router = makeRouter(failingExecutor);

  const task = await router.submitTask({
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice",
    payload: "...",
    dedupKey: "failing-task",
  });

  assert.equal(task.status, "failed");
  assert.equal(task.error, "provider billing error");

  const entries = router.ledgerFor("invoicing");
  assert.equal(entries.at(-1)!.status, "failed");
  assert.equal(entries.at(-1)!.note, "provider billing error");
});
