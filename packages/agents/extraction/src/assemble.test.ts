import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleOrgChart } from "./assemble.js";
import type { Task, TemplateSelection } from "./types.js";

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

const SELECTION: TemplateSelection = {
  primary: "saas",
  blendedWith: null,
  scores: {} as never,
  tie: false,
  confidence: "high",
};

test("assembleOrgChart derives objective as the plain-language join of an agent's own task texts", () => {
  const tasks = [
    task({ id: "t-1", agentType: "cfo-invoicing", agentLabel: "Invoicing", teamHint: "cfo", text: "Create and send invoices." }),
    task({ id: "t-2", agentType: "cfo-invoicing", agentLabel: "Invoicing", teamHint: "cfo", text: "Chase down overdue payments." }),
  ];

  const chart = assembleOrgChart("an idea", SELECTION, tasks, { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] }, []);

  const agent = chart.agents.find((a) => a.id === "cfo-invoicing")!;
  assert.equal(agent.objective, "Create and send invoices. Chase down overdue payments.");
});

test("assembleOrgChart derives budget from the agent's own most-restrictive tier, not a fixed value", () => {
  const tasks = [
    task({ id: "t-1", agentType: "support-agent", agentLabel: "Support", teamHint: "support", tier: "T1" }),
    task({ id: "t-2", agentType: "cfo-tax", agentLabel: "Tax", teamHint: "cfo", tier: "T3" }),
  ];

  const chart = assembleOrgChart("an idea", SELECTION, tasks, { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] }, []);

  const support = chart.agents.find((a) => a.id === "support-agent")!;
  const tax = chart.agents.find((a) => a.id === "cfo-tax")!;
  assert.deepEqual(support.budget, { perDayUsd: 2, source: "tier-default" });
  assert.deepEqual(tax.budget, { perDayUsd: 15, source: "tier-default" });
});

test("assembleOrgChart populates brain with a real, cost-grounded recommendation per the agent's own tier", () => {
  const tasks = [
    task({ id: "t-1", agentType: "support-agent", agentLabel: "Support", teamHint: "support", tier: "T1" }),
    task({ id: "t-2", agentType: "cfo-tax", agentLabel: "Tax", teamHint: "cfo", tier: "T3" }),
  ];

  const chart = assembleOrgChart("an idea", SELECTION, tasks, { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] }, []);

  const support = chart.agents.find((a) => a.id === "support-agent")!;
  const tax = chart.agents.find((a) => a.id === "cfo-tax")!;
  assert.equal(support.brain?.provider, "openai");
  assert.equal(tax.brain?.provider, "anthropic");
  assert.ok(support.brain?.reason.length, "reason must be non-empty");
});

test("assembleOrgChart derives riskTier from the agent's own most-restrictive task stakes", () => {
  const tasks = [
    task({ id: "t-1", agentType: "support-agent", agentLabel: "Support", teamHint: "support", stakes: "low" }),
    task({ id: "t-2", agentType: "cfo-tax", agentLabel: "Tax", teamHint: "cfo", stakes: "low" }),
    task({ id: "t-3", agentType: "cfo-tax", agentLabel: "Tax", teamHint: "cfo", stakes: "high" }),
  ];

  const chart = assembleOrgChart("an idea", SELECTION, tasks, { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] }, []);

  const support = chart.agents.find((a) => a.id === "support-agent")!;
  const tax = chart.agents.find((a) => a.id === "cfo-tax")!;
  assert.equal(support.riskTier, "low");
  assert.equal(tax.riskTier, "high");
});

test("assembleOrgChart's reportingStructure names the agent's own team and that team's role title", () => {
  const tasks = [task({ id: "t-1", agentType: "cfo-invoicing", agentLabel: "Invoicing", teamHint: "cfo" })];

  const chart = assembleOrgChart("an idea", SELECTION, tasks, { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] }, []);

  const agent = chart.agents.find((a) => a.id === "cfo-invoicing")!;
  assert.deepEqual(agent.reportingStructure, { teamId: "cfo", teamRoleTitle: "CFO" });
});

test("a compliance task's agent reports into whichever team it actually attached to (cfo/ops), not 'compliance'", () => {
  const tasks = [
    task({ id: "t-1", agentType: "cfo-books", agentLabel: "Books", teamHint: "cfo" }),
    task({
      id: "t-2",
      agentType: "compliance-license",
      agentLabel: "Licensing",
      teamHint: "compliance",
      requiresProfessionalVerification: true,
    }),
  ];

  const chart = assembleOrgChart("an idea", SELECTION, tasks, { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] }, []);

  const complianceAgent = chart.agents.find((a) => a.id === "compliance-license")!;
  assert.deepEqual(complianceAgent.reportingStructure, { teamId: "cfo", teamRoleTitle: "CFO" });
});
