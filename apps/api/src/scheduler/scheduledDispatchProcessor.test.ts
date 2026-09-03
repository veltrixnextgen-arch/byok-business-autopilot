import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, CompanyCharter, OrgChart } from "@byok/contracts";
import type { RouterTask } from "@byok/router";
import { createScheduledDispatchProcessor, UnschedulableDispatchError, type ScheduledDispatchDeps } from "./scheduledDispatchProcessor.js";
import type { ScheduledDispatchPayload } from "./computeDesiredSchedule.js";

const PAYLOAD: ScheduledDispatchPayload = { tenantId: "tenant-1", agentId: "agent-1", taskId: "task-1" };

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

const CEO_AGENT: Agent = { ...AGENT, id: "ceo-1", name: "Jordan", teamId: "founder" as never, tier: "T3" };

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
      cadence: "nightly",
      batchable: true,
      triggerType: "cadence",
    },
  ],
  customization: { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] },
  onboardingBatch: null,
};

const CHARTER: CompanyCharter = {
  id: "charter-1",
  tenantId: "tenant-1",
  version: 1,
  status: "active",
  content: { sharpenedIdea: "x", mvpDefinition: "y", roleMandates: [], monthOneGoals: [], budgetCeilingUsd: 50 },
  cascade: {
    ceo: { tier: "ceo", text: "You are Jordan, the CEO agent.", overridden: false },
    roleLeads: [],
    subAgents: [{ tier: "sub-agent", agentId: "agent-1", text: "You are Sam, the expenses agent.", overridden: false }],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  installedAt: "2026-01-01T00:00:00.000Z",
};

function baseDeps(overrides: Partial<ScheduledDispatchDeps> = {}): ScheduledDispatchDeps {
  return {
    router: { submitTask: async () => ({ status: "completed" }) as RouterTask },
    charters: { getActive: async () => CHARTER },
    batchStore: { latestForTenant: async () => ({ orgChart: CHART }) as never },
    scheduleState: { get: async () => ({ tenantId: "tenant-1", pausedAt: null, pausedReason: null, pausedBatchId: null }), pause: async () => {} },
    instrumentation: { recordScheduledRun: async () => {} },
    durableBatchStore: { pause: async () => ({ id: "paused-1", remainingTasks: [] }) as never },
    tierModelMaps: { anthropic: { T1: "model-t1", T2: "model-t2", T3: "model-t3" } },
    vault: { getBrainKeyStatus: async () => null },
    notifications: {
      getOwnerEmails: async () => [],
      emailSender: { send: async () => {} },
      ceilings: { get: async () => null },
      reservationTotals: { totals: async () => ({ totalUsd: 0, ceilingUsd: null }) },
      dashboardUrl: "https://example.com/dashboard",
    },
    ...overrides,
  };
}

test("composes RouterTaskInput from the tenant's active cascade and submits through the router", async () => {
  let seenInput: unknown;
  const deps = baseDeps({
    router: {
      submitTask: async (input) => {
        seenInput = input;
        return { status: "awaiting_review" } as RouterTask;
      },
    },
  });
  const process = createScheduledDispatchProcessor(deps);
  await process(PAYLOAD);

  const { dedupKey, ...rest } = seenInput as { dedupKey: string; [key: string]: unknown };
  assert.deepEqual(rest, {
    subAgentId: "agent-1",
    teamId: "cfo",
    title: "Categorize expenses",
    payload: "Categorize expenses",
    model: "model-t1",
    tenantId: "tenant-1",
    agentName: "Sam",
    systemPrompt: "You are Sam, the expenses agent.",
    promptTier: "sub-agent",
    batchable: true,
  });
  assert.match(dedupKey, /^task-1:/); // per-firing, timestamp-based dedup — a fixed value would defeat its own purpose
});

// Multi-provider AI (ADR-047/048 follow-up): scheduled dispatch is the
// actual path agents run through — it picks a model BEFORE the task ever
// reaches CostGate, so it needs the same provider awareness CostGate's
// own downgrade path already has. Without this, a role connected to a
// non-Anthropic provider would still get an Anthropic model string here,
// regardless of what CostGate or the executor do downstream.
test("a role whose Brain key is on a non-Anthropic provider gets that provider's own model, not the Anthropic one", async () => {
  let seenModel: string | undefined;
  const deps = baseDeps({
    vault: { getBrainKeyStatus: async () => ({ id: "k1", type: "brain", tenantId: "tenant-1", roleId: "cfo", provider: "openai", maskedFingerprint: "sk-...abcd", revoked: false, createdAt: "", updatedAt: "" }) },
    tierModelMaps: {
      anthropic: { T1: "model-t1", T2: "model-t2", T3: "model-t3" },
      openai: { T1: "gpt-t1", T2: "gpt-t2", T3: "gpt-t3" },
    },
    router: {
      submitTask: async (input) => {
        seenModel = input.model;
        return { status: "completed" } as RouterTask;
      },
    },
  });
  await createScheduledDispatchProcessor(deps)(PAYLOAD);
  assert.equal(seenModel, "gpt-t1");
});

// Week 1's narrow real-effect-dispatch scope (docs/STATUS.md): exactly
// one task type proposes a real effect. This is the ONLY thing this
// processor decides — the actual send, recipient resolution, and
// human-gating all happen later (ResendEffectExecutor, queue.ts).
test('the one Week-1 task type ("support.digest.weekly-summary") proposes a real "send" effect', async () => {
  const chart: OrgChart = {
    ...CHART,
    tasks: [{ ...CHART.tasks[0]!, id: "support.digest.weekly-summary" }],
  };
  const payload: ScheduledDispatchPayload = { ...PAYLOAD, taskId: "support.digest.weekly-summary" };
  let seenInput: unknown;
  const deps = baseDeps({
    batchStore: { latestForTenant: async () => ({ orgChart: chart }) as never },
    router: {
      submitTask: async (input) => {
        seenInput = input;
        return { status: "awaiting_review" } as RouterTask;
      },
    },
  });
  await createScheduledDispatchProcessor(deps)(payload);

  assert.deepEqual((seenInput as { effect?: unknown }).effect, {
    kind: "send",
    description: "Email Sam's weekly summary to the founder",
  });
});

test("every other task type still proposes no effect at all — this stays the exception, not the default", async () => {
  let seenInput: unknown;
  const deps = baseDeps({
    router: {
      submitTask: async (input) => {
        seenInput = input;
        return { status: "awaiting_review" } as RouterTask;
      },
    },
  });
  await createScheduledDispatchProcessor(deps)(PAYLOAD); // CHART's task-1, unchanged

  assert.equal((seenInput as { effect?: unknown }).effect, undefined);
});

test("a role with no Brain key connected yet falls back to the Anthropic map, not a crash", async () => {
  let seenModel: string | undefined;
  const deps = baseDeps({
    vault: { getBrainKeyStatus: async () => null },
    router: {
      submitTask: async (input) => {
        seenModel = input.model;
        return { status: "completed" } as RouterTask;
      },
    },
  });
  await createScheduledDispatchProcessor(deps)(PAYLOAD);
  assert.equal(seenModel, "model-t1");
});

test("a founder-team agent's task dispatches with promptTier 'ceo' and the CEO's own cascade prompt", async () => {
  const founderChart: OrgChart = { ...CHART, agents: [CEO_AGENT], tasks: [{ ...CHART.tasks[0], id: "task-2" }] };
  let seenInput: { promptTier?: string; systemPrompt?: string; model?: string } | undefined;
  const deps = baseDeps({
    batchStore: { latestForTenant: async () => ({ orgChart: founderChart }) as never },
    router: {
      submitTask: async (input) => {
        seenInput = input;
        return { status: "awaiting_review" } as RouterTask;
      },
    },
  });
  const process = createScheduledDispatchProcessor(deps);
  await process({ tenantId: "tenant-1", agentId: "ceo-1", taskId: "task-2" });

  assert.equal(seenInput?.promptTier, "ceo");
  assert.equal(seenInput?.systemPrompt, "You are Jordan, the CEO agent.");
  assert.equal(seenInput?.model, "model-t3");
});

test("does nothing (cheap no-op) when the tenant's schedule is paused — never calls the router", async () => {
  let routerCalled = false;
  const deps = baseDeps({
    scheduleState: {
      get: async () => ({ tenantId: "tenant-1", pausedAt: "2026-01-01T00:00:00.000Z", pausedReason: "ceiling-exhausted", pausedBatchId: "p-1" }),
      pause: async () => {},
    },
    router: {
      submitTask: async () => {
        routerCalled = true;
        return { status: "completed" } as RouterTask;
      },
    },
  });
  const process = createScheduledDispatchProcessor(deps);
  await process(PAYLOAD);
  assert.equal(routerCalled, false);
});

test("records instrumentation with 3 ledger rows for a full-pipeline result (pending+in_progress+terminal)", async () => {
  let recorded: { workerSeconds: number; ledgerRowsWritten: number } | undefined;
  const deps = baseDeps({
    router: { submitTask: async () => ({ status: "awaiting_review" }) as RouterTask },
    instrumentation: { recordScheduledRun: async (_tenantId, input) => { recorded = input; } },
  });
  await createScheduledDispatchProcessor(deps)(PAYLOAD);
  assert.equal(recorded?.ledgerRowsWritten, 3);
  assert.ok((recorded?.workerSeconds ?? -1) >= 0);
});

test("records instrumentation with 2 ledger rows for a queued/skipped result (never reached in_progress)", async () => {
  let recorded: { ledgerRowsWritten: number } | undefined;
  const deps = baseDeps({
    router: { submitTask: async () => ({ status: "queued" }) as RouterTask },
    instrumentation: { recordScheduledRun: async (_tenantId, input) => { recorded = input; } },
    durableBatchStore: { pause: async () => ({ id: "paused-1", remainingTasks: [] }) as never },
    scheduleState: { get: async () => ({ tenantId: "tenant-1", pausedAt: null, pausedReason: null, pausedBatchId: null }), pause: async () => {} },
  });
  await createScheduledDispatchProcessor(deps)(PAYLOAD);
  assert.equal(recorded?.ledgerRowsWritten, 2);
});

test("a 'queued' verdict (cost-gate ceiling) pauses the tenant's schedule with a resumable record", async () => {
  let pauseArgs: [string, string, string | null] | undefined;
  let durablePauseCalled = false;
  const deps = baseDeps({
    router: { submitTask: async () => ({ status: "queued" }) as RouterTask },
    durableBatchStore: {
      pause: async () => {
        durablePauseCalled = true;
        return { id: "paused-xyz", remainingTasks: [] } as never;
      },
    },
    scheduleState: {
      get: async () => ({ tenantId: "tenant-1", pausedAt: null, pausedReason: null, pausedBatchId: null }),
      pause: async (tenantId, reason, pausedBatchId) => {
        pauseArgs = [tenantId, reason, pausedBatchId];
      },
    },
  });
  await createScheduledDispatchProcessor(deps)(PAYLOAD);

  assert.equal(durablePauseCalled, true);
  assert.deepEqual(pauseArgs, ["tenant-1", "ceiling-exhausted", "paused-xyz"]);
});

test("a 'skipped' verdict also pauses the schedule — SKIP is the same cost-gate-exhaustion family as QUEUE", async () => {
  let paused = false;
  const deps = baseDeps({
    router: { submitTask: async () => ({ status: "skipped" }) as RouterTask },
    scheduleState: {
      get: async () => ({ tenantId: "tenant-1", pausedAt: null, pausedReason: null, pausedBatchId: null }),
      pause: async () => {
        paused = true;
      },
    },
  });
  await createScheduledDispatchProcessor(deps)(PAYLOAD);
  assert.equal(paused, true);
});

// Issue #140: a pause must be visible, not silently discovered later.
test("a 'queued' verdict also fires the pause notification with the real remaining-task count", async () => {
  let notified: { tenantId: string; input: unknown } | undefined;
  const deps = baseDeps({
    router: { submitTask: async () => ({ status: "queued" }) as RouterTask },
    durableBatchStore: { pause: async () => ({ id: "paused-1", remainingTasks: [{ id: "task-1" }, { id: "task-2" }] }) as never },
    notifications: {
      getOwnerEmails: async (tenantId) => {
        notified = { tenantId, input: undefined };
        return ["owner@example.com"];
      },
      emailSender: {
        send: async (input) => {
          if (notified) notified.input = input;
        },
      },
      ceilings: { get: async () => 50 },
      reservationTotals: { totals: async () => ({ totalUsd: 50, ceilingUsd: 50 }) },
      dashboardUrl: "https://example.com/dashboard",
    },
  });
  await createScheduledDispatchProcessor(deps)(PAYLOAD);

  assert.equal(notified?.tenantId, "tenant-1");
  assert.match((notified?.input as { text: string }).text, /2 tasks waiting/);
});

test("a normal 'completed'/'awaiting_review' result never pauses the schedule", async () => {
  let paused = false;
  const deps = baseDeps({
    router: { submitTask: async () => ({ status: "awaiting_review" }) as RouterTask },
    scheduleState: {
      get: async () => ({ tenantId: "tenant-1", pausedAt: null, pausedReason: null, pausedBatchId: null }),
      pause: async () => {
        paused = true;
      },
    },
  });
  await createScheduledDispatchProcessor(deps)(PAYLOAD);
  assert.equal(paused, false);
});

test("throws UnschedulableDispatchError (not a silent no-op) when the tenant has no active Charter+cascade", async () => {
  const deps = baseDeps({ charters: { getActive: async () => null } });
  await assert.rejects(() => createScheduledDispatchProcessor(deps)(PAYLOAD), UnschedulableDispatchError);
});

test("throws UnschedulableDispatchError when the agent or task no longer exists in the claimed org chart", async () => {
  const deps = baseDeps();
  await assert.rejects(
    () => createScheduledDispatchProcessor(deps)({ tenantId: "tenant-1", agentId: "nonexistent", taskId: "task-1" }),
    UnschedulableDispatchError,
  );
});
