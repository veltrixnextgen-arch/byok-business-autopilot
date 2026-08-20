import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompanyCharter, OrgChart } from "@byok/contracts";
import { buildDigestData, type DigestDeps } from "./buildDigestData.js";

const CHARTER: CompanyCharter = {
  id: "charter-1",
  tenantId: "tenant-1",
  version: 1,
  status: "active",
  content: { sharpenedIdea: "x", mvpDefinition: "y", roleMandates: [], monthOneGoals: [], budgetCeilingUsd: 50 },
  cascade: { ceo: { tier: "ceo", text: "ceo prompt", overridden: false }, roleLeads: [], subAgents: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  installedAt: "2026-01-01T00:00:00.000Z",
};

const CHART: OrgChart = {
  meta: { idea: "x", generatedAt: "2026-01-01T00:00:00.000Z", templateSelection: undefined as never, calls: [], costUsd: 0 },
  teams: [],
  agents: [
    { id: "agent-1", name: "Sam", title: "Expenses", teamId: "cfo" as never, taskIds: [], tier: "T1", brain: null, hands: [], autonomyDefault: "earnable", complianceLocked: false, requiresProfessionalVerification: false },
  ],
  tasks: [],
  customization: { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] },
  onboardingBatch: null,
};

function fakeDeps(overrides: Partial<DigestDeps> = {}): DigestDeps {
  return {
    charters: { getActive: async () => CHARTER },
    batchStore: { latestForTenant: async () => ({ orgChart: CHART }) as never },
    costActivity: { activityByTaskType: async () => [{ key: "agent-1", taskCount: 3, totalUsd: 1.5 }] },
    approvalQueue: {
      pendingActions: async () => [{ agentName: "Sam" }] as never,
      pendingRecommendationItems: async () => [] as never,
    },
    ceilings: { get: async () => null },
    reservationTotals: { totals: async () => ({ totalUsd: 12.34, ceilingUsd: null }) },
    ...overrides,
  };
}

test("resolves agent names from the org chart and sorts by spend descending", async () => {
  const deps = fakeDeps({
    costActivity: {
      activityByTaskType: async () => [
        { key: "agent-2", taskCount: 1, totalUsd: 0.05 },
        { key: "agent-1", taskCount: 3, totalUsd: 1.5 },
      ],
    },
  });
  const data = await buildDigestData(deps, "tenant-1");
  assert.ok(data);
  assert.deepEqual(
    data.agentActivity.map((a) => a.agentName),
    ["Sam", "agent-2"], // agent-2 has no org-chart match — falls back to the raw id
  );
  assert.equal(data.agentActivity[0]!.spentUsd, 1.5); // higher spend sorted first
});

test("counts pending actions and recommendations together", async () => {
  const deps = fakeDeps({
    approvalQueue: {
      pendingActions: async () => [{ agentName: "Sam" }, { agentName: "Sam" }] as never,
      pendingRecommendationItems: async () => [{ agentName: "Jordan" }] as never,
    },
  });
  const data = await buildDigestData(deps, "tenant-1");
  assert.equal(data?.pendingApprovalCount, 3);
});

test("falls back to the platform default ceiling when the tenant has no override", async () => {
  const deps = fakeDeps({ ceilings: { get: async () => null } });
  const data = await buildDigestData(deps, "tenant-1");
  assert.equal(data?.ceilingUsd, 50); // DEFAULT_MONTHLY_CEILING_USD
});

test("uses the tenant's real ceiling override when one is set", async () => {
  const deps = fakeDeps({ ceilings: { get: async () => 25 } });
  const data = await buildDigestData(deps, "tenant-1");
  assert.equal(data?.ceilingUsd, 25);
});

test("returns null (nothing honest to report) when there's no active Charter+cascade", async () => {
  const deps = fakeDeps({ charters: { getActive: async () => null } });
  const data = await buildDigestData(deps, "tenant-1");
  assert.equal(data, null);
});

test("returns null when there's no claimed org chart", async () => {
  const deps = fakeDeps({ batchStore: { latestForTenant: async () => null } });
  const data = await buildDigestData(deps, "tenant-1");
  assert.equal(data, null);
});

test("reports an empty agentActivity array (not fabricated rows) when there's genuinely no activity today", async () => {
  const deps = fakeDeps({ costActivity: { activityByTaskType: async () => [] } });
  const data = await buildDigestData(deps, "tenant-1");
  assert.deepEqual(data?.agentActivity, []);
});
