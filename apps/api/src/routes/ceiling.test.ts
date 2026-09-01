import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import { InvalidCeilingError } from "@byok/db";
import type { AppEnv, AppSession } from "../context.js";
import type { Agent, OrgChart } from "@byok/contracts";
import { ceilingRoute, DEFAULT_MONTHLY_CEILING_USD, perAgentDailyCeilingsFromOrgChart, type CeilingRouteDeps } from "./ceiling.js";

function appWithSession(tenantId: string, session: AppSession, deps: CeilingRouteDeps) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", ceilingRoute(deps));
}

const SESSION = { user: { id: "user-1", email: "cfo@example.com" }, session: {} } as never;

test("GET falls back to the platform default and reports isOverride: false when nothing is set", async () => {
  let seenTenantId: string | undefined;
  const app = appWithSession("tenant-1", SESSION, {
    ceilings: {
      get: async (tenantId) => {
        seenTenantId = tenantId;
        return null;
      },
      set: async () => {
        throw new Error("unused in this test");
      },
    },
  });

  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.equal(seenTenantId, "tenant-1");
  assert.deepEqual(await res.json(), { companyMonthlyUsd: DEFAULT_MONTHLY_CEILING_USD, isOverride: false });
});

test("GET reports the tenant's own override and isOverride: true once one is set", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    ceilings: {
      get: async () => 250,
      set: async () => {
        throw new Error("unused in this test");
      },
    },
  });

  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { companyMonthlyUsd: 250, isOverride: true });
});

test("POST rejects a non-positive body with 400 before ever calling the store", async () => {
  let setCalled = false;
  const app = appWithSession("tenant-1", SESSION, {
    ceilings: {
      get: async () => null,
      set: async () => {
        setCalled = true;
      },
    },
  });

  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ companyMonthlyUsd: -5 }),
  });

  assert.equal(res.status, 400);
  assert.equal(setCalled, false);
});

test("POST sets the tenant's override by session tenantId, not a request-supplied one", async () => {
  let seenArgs: [string, number] | undefined;
  const app = appWithSession("tenant-1", SESSION, {
    ceilings: {
      get: async () => null,
      set: async (tenantId, companyMonthlyUsd) => {
        seenArgs = [tenantId, companyMonthlyUsd];
      },
    },
  });

  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ companyMonthlyUsd: 300, tenantId: "some-other-tenant" }),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(seenArgs, ["tenant-1", 300]);
  assert.deepEqual(await res.json(), { companyMonthlyUsd: 300, isOverride: true });
});

test("POST surfaces InvalidCeilingError as a 400 with its own message, not a 500", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    ceilings: {
      get: async () => null,
      set: async () => {
        throw new InvalidCeilingError(0.00001);
      },
    },
  });

  // A positive-but-tiny value passes zod's `.positive()` check, so this
  // exercises the store's OWN validation (a second, independent guard),
  // not the route's schema.
  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ companyMonthlyUsd: 0.00001 }),
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /Invalid monthly ceiling/);
});

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

test("perAgentDailyCeilingsFromOrgChart maps each agent's own id to its own budget.perDayUsd", () => {
  const orgChart = {
    agents: [
      agent({ id: "agent-1", budget: { perDayUsd: 2, source: "tier-default" } }),
      agent({ id: "agent-2", budget: { perDayUsd: 15, source: "tier-default" } }),
    ],
  } as OrgChart;

  assert.deepEqual(perAgentDailyCeilingsFromOrgChart(orgChart), { "agent-1": 2, "agent-2": 15 });
});

test("perAgentDailyCeilingsFromOrgChart returns an empty map for a null/missing org chart, never throws", () => {
  assert.deepEqual(perAgentDailyCeilingsFromOrgChart(null), {});
  assert.deepEqual(perAgentDailyCeilingsFromOrgChart(undefined), {});
});
