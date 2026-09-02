import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import { InvalidAgentBudgetError } from "@byok/db";
import type { AppEnv, AppSession } from "../context.js";
import type { Agent, OrgChart } from "@byok/contracts";
import { agentBudgetsRoute, type AgentBudgetsRouteDeps } from "./agentBudgets.js";

function appWithSession(tenantId: string, session: AppSession, deps: AgentBudgetsRouteDeps) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", agentBudgetsRoute(deps));
}

const SESSION = { user: { id: "user-1", email: "cfo@example.com" }, session: {} } as never;

function agent(overrides: Partial<Agent> & { id: string; budget: Agent["budget"] }): Agent {
  return {
    name: "Sam",
    title: "Expenses",
    objective: "Categorize expenses.",
    teamId: "cfo" as never,
    taskIds: [],
    tier: "T1",
    brain: null,
    hands: [],
    reportingStructure: { teamId: "cfo" as never, teamRoleTitle: "CFO" },
    autonomyDefault: "earnable",
    riskTier: "low",
    complianceLocked: false,
    requiresProfessionalVerification: false,
    ...overrides,
  };
}

test("GET reports each agent's tier-default budget when no override exists", async () => {
  const orgChart = {
    agents: [agent({ id: "agent-1", budget: { perDayUsd: 2, source: "tier-default" } })],
  } as OrgChart;
  const app = appWithSession("tenant-1", SESSION, {
    batchStore: { latestForTenant: async () => ({ orgChart }) as never },
    overrides: { getAll: async () => ({}), set: async () => {} },
  });

  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    agents: [{ agentId: "agent-1", name: "Sam", title: "Expenses", perDayUsd: 2, source: "tier-default" }],
  });
});

test("GET prefers an agent's own override over its tier-default", async () => {
  const orgChart = {
    agents: [agent({ id: "agent-1", budget: { perDayUsd: 2, source: "tier-default" } })],
  } as OrgChart;
  const app = appWithSession("tenant-1", SESSION, {
    batchStore: { latestForTenant: async () => ({ orgChart }) as never },
    overrides: { getAll: async () => ({ "agent-1": 9 }), set: async () => {} },
  });

  const res = await app.request("/");
  assert.equal(res.status, 200);
  const { agents } = (await res.json()) as { agents: Array<{ perDayUsd: number; source: string }> };
  assert.equal(agents[0]!.perDayUsd, 9);
  assert.equal(agents[0]!.source, "override");
});

test("GET returns an empty list when no org chart exists yet, never throws", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    batchStore: { latestForTenant: async () => null },
    overrides: { getAll: async () => ({}), set: async () => {} },
  });

  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { agents: [] });
});

test("POST rejects a non-positive body with 400 before ever calling the store", async () => {
  let setCalled = false;
  const app = appWithSession("tenant-1", SESSION, {
    batchStore: { latestForTenant: async () => null },
    overrides: {
      getAll: async () => ({}),
      set: async () => {
        setCalled = true;
      },
    },
  });

  const res = await app.request("/agent-1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ perDayUsd: -5 }),
  });

  assert.equal(res.status, 400);
  assert.equal(setCalled, false);
});

test("POST sets the override by session tenantId and the given agentId", async () => {
  let seenArgs: [string, string, number] | undefined;
  const app = appWithSession("tenant-1", SESSION, {
    batchStore: { latestForTenant: async () => null },
    overrides: {
      getAll: async () => ({}),
      set: async (tenantId, agentId, perDayUsd) => {
        seenArgs = [tenantId, agentId, perDayUsd];
      },
    },
  });

  const res = await app.request("/agent-1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ perDayUsd: 12 }),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(seenArgs, ["tenant-1", "agent-1", 12]);
  assert.deepEqual(await res.json(), { agentId: "agent-1", perDayUsd: 12, source: "override" });
});

test("POST surfaces InvalidAgentBudgetError as a 400 with its own message, not a 500", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    batchStore: { latestForTenant: async () => null },
    overrides: {
      getAll: async () => ({}),
      set: async () => {
        throw new InvalidAgentBudgetError(0);
      },
    },
  });

  const res = await app.request("/agent-1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ perDayUsd: 0.00001 }),
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /Invalid per-agent daily budget/);
});
