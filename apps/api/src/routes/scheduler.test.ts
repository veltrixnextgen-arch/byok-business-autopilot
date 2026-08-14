import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { Agent, CompanyCharter, OrgChart, PromptCascade } from "@byok/contracts";
import type { AppEnv, AppSession } from "../context.js";
import { schedulerRoute, type SchedulerRouteDeps } from "./scheduler.js";

function appWithSession(tenantId: string, session: AppSession, deps: SchedulerRouteDeps) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", schedulerRoute(deps));
}

const SESSION = { user: { id: "user-1", email: "founder@example.com" }, session: {} } as never;

const AGENT: Agent = {
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

test("POST /sync clamps a Scale-only 15min task down to Solo's daily floor and syncs BullMQ", async () => {
  const queue = fakeQueue();
  const app = appWithSession("tenant-1", SESSION, {
    charters: { getActive: async () => makeCharter() },
    batchStore: { latestForTenant: async () => ({ orgChart: CHART }) as never },
    scheduleState: { get: async () => ({ tenantId: "tenant-1", pausedAt: null, pausedReason: null, pausedBatchId: null }), resume: async () => {} },
    instrumentation: { getDaily: async () => null },
    durableBatchStore: { complete: async () => {} },
    getTenantTier: async () => "solo",
    queue,
    jobName: "scheduled-dispatch",
  });

  const res = await app.request("/sync", { method: "POST" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { added: string[]; clampNotes: { taskId: string; reason: string }[] };
  assert.deepEqual(body.added, ["tenant-1:agent-1:task-1"]);
  assert.equal(body.clampNotes.length, 1);
  assert.match(body.clampNotes[0].reason, /Runs daily on Solo/);
  assert.equal(queue.jobs.get("tenant-1:agent-1:task-1")?.every, 24 * 60 * 60 * 1000);
});

test("POST /sync 409s when there's no active Charter+cascade to schedule from", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    charters: { getActive: async () => null },
    batchStore: { latestForTenant: async () => null },
    scheduleState: { get: async () => ({ tenantId: "tenant-1", pausedAt: null, pausedReason: null, pausedBatchId: null }), resume: async () => {} },
    instrumentation: { getDaily: async () => null },
    durableBatchStore: { complete: async () => {} },
    getTenantTier: async () => "solo",
    queue: fakeQueue(),
    jobName: "scheduled-dispatch",
  });

  const res = await app.request("/sync", { method: "POST" });
  assert.equal(res.status, 409);
});

test("GET /status reports paused state and today's instrumentation, zeroed when no row exists yet", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    charters: { getActive: async () => makeCharter() },
    batchStore: { latestForTenant: async () => null },
    scheduleState: {
      get: async () => ({ tenantId: "tenant-1", pausedAt: "2026-01-02T00:00:00.000Z", pausedReason: "ceiling-exhausted", pausedBatchId: "p-1" }),
      resume: async () => {},
    },
    instrumentation: { getDaily: async () => null },
    durableBatchStore: { complete: async () => {} },
    getTenantTier: async () => "solo",
    queue: fakeQueue(),
    jobName: "scheduled-dispatch",
  });

  const res = await app.request("/status");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { paused: boolean; pausedReason: string; today: { scheduledRunsExecuted: number } };
  assert.equal(body.paused, true);
  assert.equal(body.pausedReason, "ceiling-exhausted");
  assert.equal(body.today.scheduledRunsExecuted, 0);
});

test("POST /resume completes the paused batch record and clears the pause flag", async () => {
  let completedArgs: [string, string] | undefined;
  let resumeCalled = false;
  const app = appWithSession("tenant-1", SESSION, {
    charters: { getActive: async () => makeCharter() },
    batchStore: { latestForTenant: async () => null },
    scheduleState: {
      get: async () => ({ tenantId: "tenant-1", pausedAt: "2026-01-02T00:00:00.000Z", pausedReason: "ceiling-exhausted", pausedBatchId: "p-1" }),
      resume: async () => {
        resumeCalled = true;
      },
    },
    instrumentation: { getDaily: async () => null },
    durableBatchStore: {
      complete: async (tenantId, id) => {
        completedArgs = [tenantId, id];
      },
    },
    getTenantTier: async () => "solo",
    queue: fakeQueue(),
    jobName: "scheduled-dispatch",
  });

  const res = await app.request("/resume", { method: "POST" });
  assert.equal(res.status, 200);
  assert.deepEqual(completedArgs, ["tenant-1", "p-1"]);
  assert.equal(resumeCalled, true);
});

test("POST /resume never calls durableBatchStore.complete when there was no paused batch id", async () => {
  let completeCalled = false;
  const app = appWithSession("tenant-1", SESSION, {
    charters: { getActive: async () => makeCharter() },
    batchStore: { latestForTenant: async () => null },
    scheduleState: {
      get: async () => ({ tenantId: "tenant-1", pausedAt: null, pausedReason: null, pausedBatchId: null }),
      resume: async () => {},
    },
    instrumentation: { getDaily: async () => null },
    durableBatchStore: {
      complete: async () => {
        completeCalled = true;
      },
    },
    getTenantTier: async () => "solo",
    queue: fakeQueue(),
    jobName: "scheduled-dispatch",
  });

  await app.request("/resume", { method: "POST" });
  assert.equal(completeCalled, false);
});
