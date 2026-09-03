import assert from "node:assert/strict";
import { test } from "node:test";
import { mostRestrictiveStakes, normalizeOrgChart, TIER_DEFAULT_BUDGET_PER_DAY_USD } from "./orgChart.js";
import type { Agent, OrgChart, Task } from "./orgChart.js";

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
    cadence: null,
    batchable: false,
    triggerType: "schedule",
    ...overrides,
  } as Task;
}

function agent(overrides: Partial<Agent> & { id: string; tier: Agent["tier"]; taskIds: string[] }): Agent {
  return {
    name: "Agent",
    title: "Agent",
    objective: "does things",
    teamId: "ops",
    brain: null,
    hands: [],
    budget: { perDayUsd: 99, source: "tier-default" },
    reportingStructure: { teamId: "ops", teamRoleTitle: "Ops Lead" },
    autonomyDefault: "locked",
    riskTier: "low",
    complianceLocked: false,
    requiresProfessionalVerification: false,
    ...overrides,
  } as Agent;
}

function chart(overrides: Partial<OrgChart>): OrgChart {
  return {
    meta: { idea: "x", generatedAt: "now", templateSelection: {} as never, calls: [], costUsd: 0 },
    teams: [],
    agents: [],
    tasks: [],
    customization: { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] },
    onboardingBatch: null,
    ...overrides,
  };
}

test("mostRestrictiveStakes picks the highest-stakes task, defaulting to low", () => {
  assert.equal(mostRestrictiveStakes([]), "low");
  assert.equal(mostRestrictiveStakes([task({ id: "1", stakes: "medium" }), task({ id: "2", stakes: "low" })]), "medium");
  assert.equal(mostRestrictiveStakes([task({ id: "1", stakes: "high" }), task({ id: "2", stakes: "medium" })]), "high");
});

test("normalizeOrgChart leaves a fully-populated agent untouched", () => {
  const c = chart({
    tasks: [task({ id: "t1", stakes: "high" })],
    agents: [agent({ id: "a1", tier: "T2", taskIds: ["t1"], budget: { perDayUsd: 7, source: "tier-default" }, riskTier: "low" })],
  });
  const result = normalizeOrgChart(c);
  assert.deepEqual(result.agents[0]!.budget, { perDayUsd: 7, source: "tier-default" });
  assert.equal(result.agents[0]!.riskTier, "low");
});

test("normalizeOrgChart backfills a missing budget from the agent's tier", () => {
  const a = agent({ id: "a1", tier: "T3", taskIds: [] });
  delete (a as { budget?: unknown }).budget;
  const c = chart({ agents: [a] });
  const result = normalizeOrgChart(c);
  assert.deepEqual(result.agents[0]!.budget, { perDayUsd: TIER_DEFAULT_BUDGET_PER_DAY_USD.T3, source: "tier-default" });
});

test("normalizeOrgChart backfills a missing riskTier from the agent's own tasks", () => {
  const a = agent({ id: "a1", tier: "T1", taskIds: ["t1", "t2"] });
  delete (a as { riskTier?: unknown }).riskTier;
  const c = chart({
    tasks: [task({ id: "t1", stakes: "low" }), task({ id: "t2", stakes: "medium" })],
    agents: [a],
  });
  const result = normalizeOrgChart(c);
  assert.equal(result.agents[0]!.riskTier, "medium");
});

test("normalizeOrgChart tolerates a partial/stub chart with no agents field at all", () => {
  const c = { meta: { idea: "a laundromat" } } as unknown as OrgChart;
  assert.deepEqual(normalizeOrgChart(c), c);
});

test("normalizeOrgChart backfills both fields independently on the same agent", () => {
  const a = agent({ id: "a1", tier: "T2", taskIds: ["t1"] });
  delete (a as { budget?: unknown }).budget;
  delete (a as { riskTier?: unknown }).riskTier;
  const c = chart({ tasks: [task({ id: "t1", stakes: "high" })], agents: [a] });
  const result = normalizeOrgChart(c);
  assert.deepEqual(result.agents[0]!.budget, { perDayUsd: TIER_DEFAULT_BUDGET_PER_DAY_USD.T2, source: "tier-default" });
  assert.equal(result.agents[0]!.riskTier, "high");
});
