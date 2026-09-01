import assert from "node:assert/strict";
import { test } from "node:test";
import { generateCascade } from "./cascade.js";
import type { Charter, OrgChart, PromptCascade } from "./types.js";

const CHARTER: Charter = {
  sharpenedIdea: "A candle shop on Etsy.",
  mvpDefinition: "Sell handmade candles online.",
  roleMandates: [
    { roleTitle: "CFO", mandate: "Keeps the books current, never sends a reminder without approval.", tasks: ["Categorize expenses"] },
  ],
  monthOneGoals: ["Ship the first ten orders"],
  budgetCeilingUsd: 50,
};

const CHART: OrgChart = {
  meta: { idea: "candle shop", generatedAt: "2026-01-01T00:00:00.000Z", templateSelection: undefined as never, calls: [], costUsd: 0 },
  teams: [
    { id: "founder", roleTitle: "Founder", isHuman: true, agentIds: ["ceo-1"] },
    { id: "cfo", roleTitle: "CFO", isHuman: false, agentIds: ["agent-1"] },
  ],
  agents: [
    {
      id: "ceo-1",
      name: "Jordan",
      title: "Chief of Staff",
      objective: "Keep the founder's whole company on track.",
      teamId: "founder" as never,
      taskIds: [],
      tier: "T3",
      brain: null,
      hands: [],
      budget: { perDayUsd: 15, source: "tier-default" },
      reportingStructure: { teamId: "founder" as never, teamRoleTitle: "Founder" },
      autonomyDefault: "earnable",
      riskTier: "medium",
      complianceLocked: false,
      requiresProfessionalVerification: false,
    },
    {
      id: "agent-1",
      name: "Sam",
      title: "Expenses",
      objective: "Categorize expenses.",
      teamId: "cfo" as never,
      taskIds: ["task-1"],
      tier: "T1",
      brain: null,
      hands: ["Stripe"],
      budget: { perDayUsd: 2, source: "tier-default" },
      reportingStructure: { teamId: "cfo" as never, teamRoleTitle: "CFO" },
      autonomyDefault: "eligible-early",
      riskTier: "low",
      complianceLocked: false,
      requiresProfessionalVerification: false,
    },
  ],
  tasks: [
    {
      id: "task-1",
      text: "Categorize expenses and flag anomalies",
      agentType: "expense-categorization",
      agentLabel: "Expenses",
      teamHint: "cfo" as never,
      frequency: "weekly",
      stakes: "low",
      tier: "T1",
      autonomy: "eligible-early",
      handsTool: "Stripe",
      origin: "template",
      cadence: "nightly",
      batchable: true,
      triggerType: "cadence",
    },
  ],
  customization: { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] },
  onboardingBatch: { simulatedDay: [], charterDraft: CHARTER },
};

test("generates one CEO prompt naming the founder-team agent, and it states the recommender-only constraint", () => {
  const cascade = generateCascade(CHARTER, CHART);
  assert.ok(cascade.ceo.text.includes("Jordan"));
  assert.ok(cascade.ceo.text.includes("recommendation"));
  assert.equal(cascade.ceo.overridden, false);
});

test("generates one role-lead prompt per non-human team, skipping the human Founder team", () => {
  const cascade = generateCascade(CHARTER, CHART);
  assert.equal(cascade.roleLeads.length, 1);
  assert.equal(cascade.roleLeads[0].roleTitle, "CFO");
  assert.ok(cascade.roleLeads[0].text.includes("Keeps the books current"));
});

test("generates one sub-agent prompt per non-founder agent, including its tasks and tools", () => {
  const cascade = generateCascade(CHARTER, CHART);
  assert.equal(cascade.subAgents.length, 1);
  const sam = cascade.subAgents[0];
  assert.equal(sam.agentId, "agent-1");
  assert.ok(sam.text.includes("Categorize expenses and flag anomalies"));
  assert.ok(sam.text.includes("Stripe"));
});

test("compliance-required agents get an explicit review-with-a-professional line", () => {
  const complianceChart: OrgChart = {
    ...CHART,
    agents: CHART.agents.map((a) => (a.id === "agent-1" ? { ...a, requiresProfessionalVerification: true } : a)),
  };
  const cascade = generateCascade(CHARTER, complianceChart);
  assert.ok(cascade.subAgents[0].text.includes("licensed professional"));
});

test("regeneration preserves an overridden CEO prompt verbatim, never regenerating it silently", () => {
  const previous: PromptCascade = {
    ceo: { tier: "ceo", text: "A human wrote this instead.", overridden: true, overrideNote: "founder preference" },
    roleLeads: [],
    subAgents: [],
  };
  const regenerated = generateCascade(CHARTER, CHART, previous);
  assert.equal(regenerated.ceo.text, "A human wrote this instead.");
  assert.equal(regenerated.ceo.overridden, true);
});

test("regeneration preserves an overridden sub-agent prompt while still regenerating non-overridden ones", () => {
  const previous: PromptCascade = {
    ceo: { tier: "ceo", text: "old ceo text", overridden: false },
    roleLeads: [],
    subAgents: [{ tier: "sub-agent", agentId: "agent-1", text: "A human's own wording.", overridden: true }],
  };
  const regenerated = generateCascade(CHARTER, CHART, previous);
  assert.equal(regenerated.subAgents[0].text, "A human's own wording.");
  assert.notEqual(regenerated.ceo.text, "old ceo text"); // not overridden — regenerated fresh
});

test("a Charter content edit regenerates non-overridden text with the new content", () => {
  const editedCharter: Charter = { ...CHARTER, monthOneGoals: ["A brand-new goal"] };
  const cascade = generateCascade(editedCharter, CHART);
  assert.ok(cascade.ceo.text.includes("A brand-new goal"));
});
