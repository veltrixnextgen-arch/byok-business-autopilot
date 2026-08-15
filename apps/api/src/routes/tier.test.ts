import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { Agent, CompanyCharter, OrgChart, PromptCascade } from "@byok/contracts";
import type { AppEnv, AppSession } from "../context.js";
import { tierRoute, type TierRouteDeps } from "./tier.js";

function appWithSession(tenantId: string, session: AppSession, deps: TierRouteDeps) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", tierRoute(deps));
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

test("GET / reports the tenant's current tier", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    getTenantTier: async () => "company",
    setTenantTier: async () => {},
    charters: { getActive: async () => null },
    batchStore: { latestForTenant: async () => null },
    queue: fakeQueue(),
    jobName: "scheduled-dispatch",
  });

  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { tier: "company" });
});

test("POST / rejects a tier outside the three real, shipped tiers", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    getTenantTier: async () => "solo",
    setTenantTier: async () => {
      throw new Error("should not be called");
    },
    charters: { getActive: async () => null },
    batchStore: { latestForTenant: async () => null },
    queue: fakeQueue(),
    jobName: "scheduled-dispatch",
  });

  const res = await app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier: "founder" }),
  });
  assert.equal(res.status, 400);
});

test("POST / persists the new tier and re-syncs an already-installed schedule to the new floor", async () => {
  const queue = fakeQueue();
  let persistedTier: string | undefined;
  const app = appWithSession("tenant-1", SESSION, {
    getTenantTier: async () => "solo",
    setTenantTier: async (_tenantId, tier) => {
      persistedTier = tier;
    },
    charters: { getActive: async () => makeCharter() },
    batchStore: { latestForTenant: async () => ({ orgChart: CHART }) as never },
    queue,
    jobName: "scheduled-dispatch",
  });

  const res = await app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier: "scale" }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { tier: string; resynced: boolean; added: string[]; clampNotes: unknown[] };

  assert.equal(persistedTier, "scale");
  assert.equal(body.tier, "scale");
  assert.equal(body.resynced, true);
  // Scale's floor is 15min, matching the task's own declared cadence —
  // no clamp needed, unlike Solo's default floor.
  assert.equal(body.clampNotes.length, 0);
  assert.equal(queue.jobs.get("tenant-1:agent-1:task-1")?.every, 15 * 60 * 1000);
});

test("POST / downgrading re-clamps an existing faster-than-floor schedule down, not just up", async () => {
  const queue = fakeQueue();
  const app = appWithSession("tenant-1", SESSION, {
    getTenantTier: async () => "scale",
    setTenantTier: async () => {},
    charters: { getActive: async () => makeCharter() },
    batchStore: { latestForTenant: async () => ({ orgChart: CHART }) as never },
    queue,
    jobName: "scheduled-dispatch",
  });

  const res = await app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier: "solo" }),
  });
  const body = (await res.json()) as { clampNotes: { taskId: string; reason: string }[] };

  assert.equal(body.clampNotes.length, 1);
  assert.match(body.clampNotes[0].reason, /Runs daily on Solo/);
  assert.equal(queue.jobs.get("tenant-1:agent-1:task-1")?.every, 24 * 60 * 60 * 1000);
});

test("POST / with no active Charter/claimed org chart yet still persists the tier, just doesn't resync", async () => {
  let persistedTier: string | undefined;
  const app = appWithSession("tenant-1", SESSION, {
    getTenantTier: async () => "solo",
    setTenantTier: async (_tenantId, tier) => {
      persistedTier = tier;
    },
    charters: { getActive: async () => null },
    batchStore: { latestForTenant: async () => null },
    queue: fakeQueue(),
    jobName: "scheduled-dispatch",
  });

  const res = await app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier: "company" }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { tier: string; resynced: boolean };
  assert.equal(persistedTier, "company");
  assert.equal(body.resynced, false);
});
