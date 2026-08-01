import { test } from "node:test";
import assert from "node:assert/strict";
import { BatchExhaustionManager, UnknownPausedBatchError, isAutoRetryable } from "./exhaustion.js";

test("pause preserves completed work and serializes remaining tasks", () => {
  const manager = new BatchExhaustionManager();
  const state = manager.pause({
    reason: "provider-billing-failure",
    completedTaskIds: ["task-1", "task-2"],
    remainingTasks: [{ id: "task-3", payload: "..." }, { id: "task-4", payload: "..." }],
    context: { batchId: "batch-42" },
  });

  assert.equal(state.reason, "provider-billing-failure");
  assert.deepEqual(state.completedTaskIds, ["task-1", "task-2"]);
  assert.equal(state.remainingTasks.length, 2);
});

test("resume round-trip: get the paused state back by id, unchanged, until explicitly completed", () => {
  const manager = new BatchExhaustionManager();
  const paused = manager.pause({
    reason: "ceiling-exhausted",
    completedTaskIds: ["task-1"],
    remainingTasks: [{ id: "task-2" }],
  });

  const resumed = manager.resume(paused.id);
  assert.deepEqual(resumed, paused);

  // A resume attempt that itself fails part-way must be resumable again —
  // resume() must NOT clear state as a side effect.
  const resumedAgain = manager.resume(paused.id);
  assert.deepEqual(resumedAgain, paused);

  manager.complete(paused.id);
  assert.throws(() => manager.resume(paused.id), UnknownPausedBatchError);
});

test("resuming or completing an unknown batch id throws", () => {
  const manager = new BatchExhaustionManager();
  assert.throws(() => manager.resume("does-not-exist"), UnknownPausedBatchError);
  assert.throws(() => manager.complete("does-not-exist"), UnknownPausedBatchError);
});

test("list() surfaces every currently-paused batch", () => {
  const manager = new BatchExhaustionManager();
  manager.pause({ reason: "ceiling-exhausted", completedTaskIds: [], remainingTasks: [{ id: "a" }] });
  manager.pause({ reason: "provider-billing-failure", completedTaskIds: [], remainingTasks: [{ id: "b" }] });
  assert.equal(manager.list().length, 2);
});

test("retry policy: transient failures are retryable, budget-exhaustion and billing failures are never auto-retried", () => {
  assert.equal(isAutoRetryable("transient"), true);
  assert.equal(isAutoRetryable("budget-exhaustion"), false);
  assert.equal(isAutoRetryable("provider-billing"), false);
});
