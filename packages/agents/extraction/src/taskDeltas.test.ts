import { test } from "node:test";
import assert from "node:assert/strict";
import { customizationLogToDeltas, diffTaskLists } from "./taskDeltas.js";
import type { CustomizationLog, Task } from "./types.js";

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    text: "a task",
    agentType: "x",
    agentLabel: "X",
    teamHint: "ops",
    frequency: "weekly",
    stakes: "low",
    tier: "T1",
    autonomy: "locked",
    handsTool: null,
    origin: "template",
    ...overrides,
  } as Task;
}

test("diffTaskLists reports an added task not present before", () => {
  const before = [task({ id: "t-1" })];
  const after = [task({ id: "t-1" }), task({ id: "t-2", text: "new one" })];

  const deltas = diffTaskLists(before, after);

  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].taskId, "t-2");
  assert.equal(deltas[0].kind, "added");
  assert.equal(deltas[0].detail?.text, "new one");
});

test("diffTaskLists reports a removed task no longer present after, with null detail", () => {
  const before = [task({ id: "t-1" }), task({ id: "t-2" })];
  const after = [task({ id: "t-1" })];

  const deltas = diffTaskLists(before, after);

  assert.deepEqual(deltas, [{ taskId: "t-2", kind: "removed", detail: null }]);
});

test("diffTaskLists reports a frequency change for a task present in both", () => {
  const before = [task({ id: "t-1", frequency: "weekly" })];
  const after = [task({ id: "t-1", frequency: "daily" })];

  const deltas = diffTaskLists(before, after);

  assert.deepEqual(deltas, [{ taskId: "t-1", kind: "frequency_changed", detail: { from: "weekly", to: "daily" } }]);
});

test("diffTaskLists returns nothing for two identical lists", () => {
  const list = [task({ id: "t-1" }), task({ id: "t-2" })];
  assert.deepEqual(diffTaskLists(list, list), []);
});

test("customizationLogToDeltas maps added/removed/frequencyAdjustments to the same TaskDelta shape", () => {
  const log: CustomizationLog = {
    added: ["t-added"],
    removed: ["t-removed"],
    frequencyAdjustments: [{ taskId: "t-freq", from: "weekly", to: "daily" }],
    categoryCorrections: [],
  };
  const after = [task({ id: "t-added", text: "the added one" })];

  const deltas = customizationLogToDeltas(log, after);

  assert.equal(deltas.length, 3);
  assert.deepEqual(
    deltas.find((d) => d.taskId === "t-removed"),
    { taskId: "t-removed", kind: "removed", detail: null },
  );
  assert.deepEqual(
    deltas.find((d) => d.taskId === "t-freq"),
    { taskId: "t-freq", kind: "frequency_changed", detail: { from: "weekly", to: "daily" } },
  );
  const addedDelta = deltas.find((d) => d.taskId === "t-added");
  assert.equal(addedDelta?.kind, "added");
  assert.equal(addedDelta?.detail?.text, "the added one");
});

test("customizationLogToDeltas skips an added id that isn't in the final task list rather than throwing", () => {
  const log: CustomizationLog = { added: ["missing"], removed: [], frequencyAdjustments: [], categoryCorrections: [] };
  assert.deepEqual(customizationLogToDeltas(log, []), []);
});
