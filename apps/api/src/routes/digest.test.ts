import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { AppEnv, AppSession } from "../context.js";
import { digestRoute } from "./digest.js";
import type { DigestDeps } from "../digest/buildDigestData.js";

const SESSION = { user: { id: "user-1", email: "founder@example.com" }, session: {} } as never;

function appWithSession(tenantId: string, session: AppSession, deps: DigestDeps) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", digestRoute(deps));
}

function fakeDeps(overrides: Partial<DigestDeps> = {}): DigestDeps {
  return {
    charters: { getActive: async () => ({ cascade: {} }) as never },
    batchStore: { latestForTenant: async () => ({ orgChart: { agents: [] } }) as never },
    costActivity: { activityByTaskType: async () => [] },
    approvalQueue: { pendingActions: async () => [], pendingRecommendationItems: async () => [] },
    ceilings: { get: async () => 50 },
    reservationTotals: { totals: async () => ({ totalUsd: 0, ceilingUsd: 50 }) },
    ...overrides,
  };
}

test("GET / returns today's real digest for a tenant with an active Charter+org chart", async () => {
  const app = appWithSession("tenant-1", SESSION, fakeDeps());
  const res = await app.request("/");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { digest: { tenantId: string } | null };
  assert.equal(body.digest?.tenantId, "tenant-1");
});

test("GET / returns { digest: null } (not a 404 or error) for a tenant with no active Charter yet", async () => {
  const app = appWithSession("tenant-1", SESSION, fakeDeps({ charters: { getActive: async () => null } }));
  const res = await app.request("/");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { digest: unknown };
  assert.equal(body.digest, null);
});
