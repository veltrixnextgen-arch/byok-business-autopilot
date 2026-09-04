import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveObjective, mostRestrictiveStakes, normalizeOrgChart, ROLE_TITLES, TIER_DEFAULT_BUDGET_PER_DAY_USD } from "./orgChart.js";
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

// Found live 2026-09-04: customize.ts's handsTool is free-text (no enum
// constraint against HANDS_AUTH_METHOD's registry keys), so the LLM can
// write "Google Calendar" where the real, connectable key is "Calendar"
// — silently landing the agent in the oauth-pending (draft-only) UI
// branch instead of oauth-live (a real Google OAuth connect button)
// even though the integration exists.
test("normalizeOrgChart maps a legacy 'Google Calendar' hands label to the real registry key 'Calendar', on both the agent and its task", () => {
  const a = agent({ id: "a1", tier: "T1", taskIds: ["t1"], hands: ["Google Calendar"] });
  const c = chart({ tasks: [task({ id: "t1", handsTool: "Google Calendar" })], agents: [a] });
  const result = normalizeOrgChart(c);
  assert.deepEqual(result.agents[0]!.hands, ["Calendar"]);
  assert.equal(result.tasks[0]!.handsTool, "Calendar");
});

test("normalizeOrgChart's hands-label fix applies even to an otherwise fully-populated agent — it's independent of the four-field backfill", () => {
  const a = agent({
    id: "a1",
    tier: "T1",
    taskIds: [],
    hands: ["Google Calendar"],
    budget: { perDayUsd: 2, source: "tier-default" },
    riskTier: "low",
  });
  const c = chart({ agents: [a] });
  const result = normalizeOrgChart(c);
  assert.deepEqual(result.agents[0]!.hands, ["Calendar"]);
});

test("normalizeOrgChart leaves an already-correct or unrelated hands label untouched", () => {
  const a = agent({ id: "a1", tier: "T1", taskIds: ["t1"], hands: ["Calendar", "Stripe"] });
  const c = chart({ tasks: [task({ id: "t1", handsTool: "Shared inbox" })], agents: [a] });
  const result = normalizeOrgChart(c);
  assert.deepEqual(result.agents[0]!.hands, ["Calendar", "Stripe"]);
  assert.equal(result.tasks[0]!.handsTool, "Shared inbox");
});

test("normalizeOrgChart never invents a tasks array on a stub chart that never had one", () => {
  const c = { meta: { idea: "a laundromat" }, agents: [] } as unknown as OrgChart;
  const result = normalizeOrgChart(c);
  assert.equal(result.tasks, undefined);
});

test("normalizeOrgChart tolerates a partial/stub chart with no agents field at all", () => {
  const c = { meta: { idea: "a laundromat" } } as unknown as OrgChart;
  assert.deepEqual(normalizeOrgChart(c), c);
});

test("normalizeOrgChart backfills a missing objective from the agent's own task text", () => {
  const a = agent({ id: "a1", tier: "T1", taskIds: ["t1", "t2"] });
  delete (a as { objective?: unknown }).objective;
  const c = chart({
    tasks: [task({ id: "t1", text: "Send invoices" }), task({ id: "t2", text: "Chase overdue payments" })],
    agents: [a],
  });
  const result = normalizeOrgChart(c);
  assert.equal(result.agents[0]!.objective, deriveObjective(c.tasks));
  assert.equal(result.agents[0]!.objective, "Send invoices Chase overdue payments");
});

test("normalizeOrgChart backfills a missing reportingStructure from the agent's own team", () => {
  const a = agent({ id: "a1", tier: "T1", taskIds: [], teamId: "cfo" });
  delete (a as { reportingStructure?: unknown }).reportingStructure;
  const c = chart({ agents: [a] });
  const result = normalizeOrgChart(c);
  assert.deepEqual(result.agents[0]!.reportingStructure, { teamId: "cfo", teamRoleTitle: ROLE_TITLES.cfo });
});

test("normalizeOrgChart backfills all four fields independently on the same agent — the real shape of Acme's 18 pre-existing agents", () => {
  const a = agent({ id: "a1", tier: "T2", taskIds: ["t1"], teamId: "support" });
  delete (a as { budget?: unknown }).budget;
  delete (a as { riskTier?: unknown }).riskTier;
  delete (a as { objective?: unknown }).objective;
  delete (a as { reportingStructure?: unknown }).reportingStructure;
  const c = chart({ tasks: [task({ id: "t1", stakes: "high", text: "Triage support tickets" })], agents: [a] });
  const result = normalizeOrgChart(c);
  assert.deepEqual(result.agents[0]!.budget, { perDayUsd: TIER_DEFAULT_BUDGET_PER_DAY_USD.T2, source: "tier-default" });
  assert.equal(result.agents[0]!.riskTier, "high");
  assert.equal(result.agents[0]!.objective, "Triage support tickets");
  assert.deepEqual(result.agents[0]!.reportingStructure, { teamId: "support", teamRoleTitle: ROLE_TITLES.support });
});
