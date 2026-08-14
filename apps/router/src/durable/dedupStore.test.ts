import assert from "node:assert/strict";
import { test } from "node:test";
import type { RouterTask } from "../types.js";
import { InMemoryDurableDedupStore } from "./dedupStore.js";

function makeTask(overrides: Partial<RouterTask> = {}): RouterTask {
  return {
    id: "task-1",
    tenantId: "t1",
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Draft invoice",
    payload: "...",
    tags: [],
    dedupKey: "dk-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "pending",
    promptTier: "sub-agent",
    ...overrides,
  };
}

test("getOrCreate creates the task on first call", async () => {
  const store = new InMemoryDurableDedupStore();
  const result = await store.getOrCreate("t1", "dk-1", () => makeTask());
  assert.equal(result.created, true);
  assert.equal(result.task.dedupKey, "dk-1");
});

test("getOrCreate on a second call with the same dedupKey returns the existing task, never creates a second one", async () => {
  const store = new InMemoryDurableDedupStore();
  const first = await store.getOrCreate("t1", "dk-1", () => makeTask({ id: "task-1" }));
  const second = await store.getOrCreate("t1", "dk-1", () => makeTask({ id: "task-2" }));

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.task.id, "task-1", "must return the FIRST task, the factory for the second call must be ignored");
});

test("update persists status changes, visible on subsequent get()", async () => {
  const store = new InMemoryDurableDedupStore();
  const { task } = await store.getOrCreate("t1", "dk-1", () => makeTask());
  await store.update({ ...task, status: "completed", result: "done" });

  const fetched = await store.get("t1", "dk-1");
  assert.equal(fetched?.status, "completed");
  assert.equal(fetched?.result, "done");
});

test("dedup keys are isolated per tenant — same key, different tenants, independent tasks", async () => {
  const store = new InMemoryDurableDedupStore();
  const t1 = await store.getOrCreate("t1", "dk-1", () => makeTask({ id: "t1-task", tenantId: "t1" }));
  const t2 = await store.getOrCreate("t2", "dk-1", () => makeTask({ id: "t2-task", tenantId: "t2" }));

  assert.equal(t1.created, true);
  assert.equal(t2.created, true, "tenant t2 must get its own task even though it reused tenant t1's dedupKey string");
  assert.notEqual(t1.task.id, t2.task.id);
});
