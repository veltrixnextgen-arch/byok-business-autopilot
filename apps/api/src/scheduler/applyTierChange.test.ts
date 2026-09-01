import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, CompanyCharter, OrgChart, PromptCascade } from "@byok/contracts";
import { applyTierChange } from "./applyTierChange.js";

const AGENT: Agent = {
  id: "agent-1",
  name: "Sam",
  title: "Expenses",
  objective: "Categorize expenses.",
  teamId: "cfo" as never,
  taskIds: ["task-1"],
  tier: "T1",
  brain: null,
  hands: [],
  budget: { perDayUsd: 2, source: "tier-default" },
  reportingStructure: { teamId: "cfo" as never, teamRoleTitle: "CFO" },
  autonomyDefault: "earnable",
  riskTier: "low",
  complianceLocked: false,
  requiresProfessionalVerification: false,
};

const CHART: OrgChart = {
  meta: { idea: "x", generatedAt: "2026-01-01T00:00:00.000Z", templateSelection: undefined as never, calls: [], costUsd: 0 },
  teams: [],
  agents: [AGENT],
  tasks: [
    {
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
      cadence: "15min",
      batchable: true,
      triggerType: "cadence",
    },
  ],
  customization: { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] },
  onboardingBatch: null,
};

const CASCADE: PromptCascade = {
  ceo: { tier: "ceo", text: "ceo prompt", overridden: false },
  roleLeads: [],
  subAgents: [{ tier: "sub-agent", agentId: "agent-1", text: "sub-agent prompt", overridden: false }],
};

function makeCharter(overrides: Partial<CompanyCharter> = {}): CompanyCharter {
  return {
    id: "charter-1",
    tenantId: "tenant-1",
    version: 1,
    status: "active",
    content: { sharpenedIdea: "x", mvpDefinition: "y", roleMandates: [], monthOneGoals: [], budgetCeilingUsd: 50 },
    cascade: CASCADE,
    createdAt: "2026-01-01T00:00:00.000Z",
    installedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeQueue() {
  const jobs = new Map<string, { every?: number; pattern?: string }>();
  return {
    jobs,
    async upsertJobScheduler(id: string, repeat: { every?: number; pattern?: string }) {
      jobs.set(id, repeat);
    },
    async getJobSchedulers() {
      return [...jobs.entries()].map(([id, r]) => ({ id, ...r }));
    },
    async removeJobScheduler(id: string) {
      return jobs.delete(id);
    },
  };
}

test("persists 'solo' and re-syncs an already-installed schedule, clamping to the one floor", async () => {
  const queue = fakeQueue();
  let persistedTier: string | undefined;
  const result = await applyTierChange(
    {
      setTenantTier: async (_tenantId, tier) => {
        persistedTier = tier;
      },
      charters: { getActive: async () => makeCharter() },
      batchStore: { latestForTenant: async () => ({ orgChart: CHART }) as never },
      queue,
      jobName: "scheduled-dispatch",
    },
    "tenant-1",
  );

  assert.equal(persistedTier, "solo");
  assert.equal(result.resynced, true);
  // The task declares 15min; the one plan's floor is daily, so this
  // always clamps now — there's no faster tier left to be on.
  assert.equal(result.clampNotes.length, 1);
  assert.match(result.clampNotes[0].reason, /Runs daily/);
  assert.equal(queue.jobs.get("tenant-1:agent-1:task-1")?.every, 24 * 60 * 60 * 1000);
});

test("with no active Charter/claimed org chart yet still persists 'solo', just doesn't resync", async () => {
  let persistedTier: string | undefined;
  const result = await applyTierChange(
    {
      setTenantTier: async (_tenantId, tier) => {
        persistedTier = tier;
      },
      charters: { getActive: async () => null },
      batchStore: { latestForTenant: async () => null },
      queue: fakeQueue(),
      jobName: "scheduled-dispatch",
    },
    "tenant-1",
  );

  assert.equal(persistedTier, "solo");
  assert.equal(result.resynced, false);
  assert.deepEqual(result.added, []);
});
