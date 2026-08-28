import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, OrgChart, Task } from "@byok/contracts";
import { computeDesiredSchedule } from "./computeDesiredSchedule.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Sam",
    title: "Expenses",
    teamId: "cfo" as never,
    taskIds: ["task-1"],
    tier: "T1",
    brain: null,
    hands: [],
    autonomyDefault: "earnable",
    complianceLocked: false,
    requiresProfessionalVerification: false,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    text: "Categorize expenses",
    agentType: "expense-categorization",
    agentLabel: "Expenses",
    teamHint: "cfo" as never,
    frequency: "weekly",
    stakes: "low",
    tier: "T1",
    autonomy: "earnable",
    handsTool: null,
    origin: "template",
    cadence: "nightly",
    batchable: true,
    triggerType: "cadence",
    ...overrides,
  };
}

function makeChart(agents: Agent[], tasks: Task[]): OrgChart {
  return {
    meta: { idea: "x", generatedAt: "2026-01-01T00:00:00.000Z", templateSelection: undefined as never, calls: [], costUsd: 0 },
    teams: [],
    agents,
    tasks,
    customization: { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] },
    onboardingBatch: null,
  };
}

test("schedules a cadence-triggered task with its owning agent, jobSchedulerId scoped by tenant/agent/task", () => {
  const chart = makeChart([makeAgent()], [makeTask()]);
  const { desired } = computeDesiredSchedule("tenant-1", chart);

  assert.equal(desired.length, 1);
  assert.equal(desired[0].jobSchedulerId, "tenant-1:agent-1:task-1");
  assert.equal(desired[0].cadence, "nightly");
});

test("skips a task whose triggerType is not 'cadence' — event/threshold tasks aren't scheduled by R3", () => {
  const chart = makeChart(
    [makeAgent()],
    [makeTask({ triggerType: "event", cadence: null }), makeTask({ id: "task-2", triggerType: "threshold", cadence: "daily" })],
  );
  const { desired } = computeDesiredSchedule("tenant-1", chart);
  assert.equal(desired.length, 0);
});

test("skips a task with no owning agent rather than throwing", () => {
  const chart = makeChart([], [makeTask()]);
  const { desired } = computeDesiredSchedule("tenant-1", chart);
  assert.equal(desired.length, 0);
});

test("clamps a task's cadence to the plan's one floor and surfaces the reason", () => {
  const chart = makeChart([makeAgent()], [makeTask({ cadence: "15min", triggerType: "cadence" })]);
  const { desired, clampNotes } = computeDesiredSchedule("tenant-1", chart);

  assert.equal(desired[0].cadence, "daily");
  assert.equal(clampNotes.length, 1);
  assert.equal(clampNotes[0].taskId, "task-1");
  assert.match(clampNotes[0].reason, /Runs daily/);
});

test("no clamp note when the declared cadence is already within the floor", () => {
  const chart = makeChart([makeAgent()], [makeTask({ cadence: "weekly" })]);
  const { clampNotes } = computeDesiredSchedule("tenant-1", chart);
  assert.deepEqual(clampNotes, []);
});

test("schedules every non-founder agent's task, and a founder-team task alongside it (the CEO's own cadence job)", () => {
  const chart = makeChart(
    [makeAgent(), makeAgent({ id: "ceo-1", teamId: "founder" as never, taskIds: ["task-2"] })],
    [makeTask(), makeTask({ id: "task-2", agentType: "chief-of-staff", teamHint: "founder" as never, cadence: "weekly" })],
  );
  const { desired } = computeDesiredSchedule("tenant-1", chart);
  assert.equal(desired.length, 2);
  assert.ok(desired.some((d) => d.jobSchedulerId === "tenant-1:ceo-1:task-2"));
});
