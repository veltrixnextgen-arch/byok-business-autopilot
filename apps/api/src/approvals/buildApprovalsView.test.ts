import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProposedAction, RecommendationItem } from "@byok/approval-queue";
import { buildApprovalsView, type ApprovalsViewDeps } from "./buildApprovalsView.js";

const ACTION: ProposedAction = {
  id: "action-1",
  tenantId: "tenant-1",
  agentName: "Sam",
  roleTitle: "Expenses",
  taskType: "agent-1",
  summary: "Categorize expenses",
  draft: "Categorized 12 transactions.",
  stakesTags: ["low-stakes"],
  effect: { kind: "post", description: "Posts the categorized transactions to QuickBooks." },
  createdAt: "2026-08-20T01:00:00.000Z",
};

const DENY_ACTION: ProposedAction = {
  ...ACTION,
  id: "action-2",
  stakesTags: ["money-movement"],
  createdAt: "2026-08-20T00:00:00.000Z",
};

const RECOMMENDATION: RecommendationItem = {
  id: "rec-1",
  tenantId: "tenant-1",
  agentName: "Jordan",
  roleTitle: "CEO",
  summary: "Weekly plan",
  draft: "Focus on retention this week.",
  stakesTags: [],
  createdAt: "2026-08-20T02:00:00.000Z",
};

function fakeDeps(overrides: Partial<ApprovalsViewDeps> = {}): ApprovalsViewDeps {
  return {
    approvalQueue: {
      pendingActions: async () => [ACTION],
      pendingRecommendationItems: async () => [],
    },
    costActivity: {
      costByRefIds: async () => ({}),
      autonomyStatus: async () => [],
    },
    ...overrides,
  };
}

test("maps a pending action's real fields, including its effect description as 'if you approve'", async () => {
  const deps = fakeDeps({ costActivity: { costByRefIds: async () => ({ "action-1": 1.5 }), autonomyStatus: async () => [] } });
  const view = await buildApprovalsView(deps, "tenant-1");
  assert.deepEqual(view.items, [
    {
      id: "action-1",
      kind: "action",
      agentName: "Sam",
      roleTitle: "Expenses",
      taskType: "agent-1",
      title: "Categorize expenses",
      output: "Categorized 12 transactions.",
      effectDescription: "Posts the categorized transactions to QuickBooks.",
      stakesTags: ["low-stakes"],
      neverEarnsAutonomy: false,
      costUsd: 1.5,
      createdAt: "2026-08-20T01:00:00.000Z",
    },
  ]);
});

test("flags a deny-listed action's stakesTags as never earning autonomy — the real gating check, not a guess", async () => {
  const deps = fakeDeps({ approvalQueue: { pendingActions: async () => [DENY_ACTION], pendingRecommendationItems: async () => [] } });
  const view = await buildApprovalsView(deps, "tenant-1");
  assert.equal(view.items[0]!.neverEarnsAutonomy, true);
});

test("a pure-draft action (no effect) reports effectDescription: null, not a fabricated string", async () => {
  const draftOnly: ProposedAction = { ...ACTION, effect: undefined };
  const deps = fakeDeps({ approvalQueue: { pendingActions: async () => [draftOnly], pendingRecommendationItems: async () => [] } });
  const view = await buildApprovalsView(deps, "tenant-1");
  assert.equal(view.items[0]!.effectDescription, null);
});

test("recommendations appear with taskType: null and effectDescription: null — T10 items never carry either", async () => {
  const deps = fakeDeps({ approvalQueue: { pendingActions: async () => [], pendingRecommendationItems: async () => [RECOMMENDATION] } });
  const view = await buildApprovalsView(deps, "tenant-1");
  assert.equal(view.items[0]!.kind, "recommendation");
  assert.equal(view.items[0]!.taskType, null);
  assert.equal(view.items[0]!.effectDescription, null);
});

test("merges actions and recommendations into one queue, oldest first", async () => {
  const deps = fakeDeps({
    approvalQueue: { pendingActions: async () => [ACTION, DENY_ACTION], pendingRecommendationItems: async () => [RECOMMENDATION] },
  });
  const view = await buildApprovalsView(deps, "tenant-1");
  assert.deepEqual(
    view.items.map((i) => i.id),
    ["action-2", "action-1", "rec-1"], // DENY_ACTION created earliest
  );
});

test("costUsd is null (not 0) when no matching cost-gate reservation exists", async () => {
  const deps = fakeDeps({ costActivity: { costByRefIds: async () => ({}), autonomyStatus: async () => [] } });
  const view = await buildApprovalsView(deps, "tenant-1");
  assert.equal(view.items[0]!.costUsd, null);
});

test("passes through real autonomyStatus rows unchanged", async () => {
  const status = [{ taskType: "agent-1", active: false, consecutiveApprovals: 7, offeredAt: null }];
  const deps = fakeDeps({ costActivity: { costByRefIds: async () => ({}), autonomyStatus: async () => status } });
  const view = await buildApprovalsView(deps, "tenant-1");
  assert.deepEqual(view.autonomyStatus, status);
});
