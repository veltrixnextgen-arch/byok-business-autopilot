import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryDurableBatchStore, UnknownDurablePausedBatchError } from "./batchStore.js";

test("pause preserves completed work and serializes remaining tasks", async () => {
  const store = new InMemoryDurableBatchStore();
  const state = await store.pause({
    tenantId: "t1",
    reason: "ceiling-exhausted",
    completedTaskIds: ["a", "b"],
    remainingTasks: [{ id: "c" }, { id: "d" }],
  });
  assert.deepEqual(state.completedTaskIds, ["a", "b"]);
  assert.equal(state.remainingTasks.length, 2);
});

test("resume returns the same state without clearing it — a failed resume can retry from the same point", async () => {
  const store = new InMemoryDurableBatchStore();
  const paused = await store.pause({ tenantId: "t1", reason: "provider-billing-failure", completedTaskIds: [], remainingTasks: [{ id: "x" }] });

  const first = await store.resume("t1", paused.id);
  const second = await store.resume("t1", paused.id);
  assert.deepEqual(first, second);
});

test("complete removes the paused batch", async () => {
  const store = new InMemoryDurableBatchStore();
  const paused = await store.pause({ tenantId: "t1", reason: "ceiling-exhausted", completedTaskIds: [], remainingTasks: [] });
  await store.complete("t1", paused.id);
  await assert.rejects(() => store.get("t1", paused.id), UnknownDurablePausedBatchError);
});

test("list surfaces every currently-paused batch for a tenant, and only that tenant", async () => {
  const store = new InMemoryDurableBatchStore();
  await store.pause({ tenantId: "t1", reason: "ceiling-exhausted", completedTaskIds: [], remainingTasks: [] });
  await store.pause({ tenantId: "t1", reason: "provider-billing-failure", completedTaskIds: [], remainingTasks: [] });
  await store.pause({ tenantId: "t2", reason: "ceiling-exhausted", completedTaskIds: [], remainingTasks: [] });

  const t1Batches = await store.list("t1");
  assert.equal(t1Batches.length, 2);
});

test("resuming or completing an unknown batch, or one from another tenant, throws", async () => {
  const store = new InMemoryDurableBatchStore();
  const paused = await store.pause({ tenantId: "t1", reason: "ceiling-exhausted", completedTaskIds: [], remainingTasks: [] });

  await assert.rejects(() => store.get("t1", "not-a-real-id"), UnknownDurablePausedBatchError);
  await assert.rejects(() => store.get("t2", paused.id), UnknownDurablePausedBatchError, "tenant t2 must not see tenant t1's paused batch");
});
