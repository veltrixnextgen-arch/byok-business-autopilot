import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { AppEnv, AppSession } from "../context.js";
import { meRoute, type MeRouteDeps } from "./me.js";

function appWithSession(tenantId: string, session: AppSession, deps: MeRouteDeps) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", meRoute(deps));
}

function fakeDeps(overrides: Partial<MeRouteDeps["batchStore"]> = {}): MeRouteDeps {
  return {
    batchStore: {
      claimLatestForTenant: async () => {
        throw new Error("unused in this test");
      },
      latestForTenant: async () => {
        throw new Error("unused in this test");
      },
      ...overrides,
    },
  };
}

test("returns the authenticated user's id, email, and tenant from the session — not the request", async () => {
  const app = appWithSession(
    "tenant-1",
    { user: { id: "user-1", email: "cfo@example.com" }, session: {} } as never,
    fakeDeps(),
  );

  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { userId: "user-1", email: "cfo@example.com", tenantId: "tenant-1" });
});

test("claim-org-chart passes the session's userId and tenantId through, not anything from the request", async () => {
  let seenArgs: [string, string] | undefined;
  const app = appWithSession(
    "tenant-1",
    { user: { id: "user-1", email: "cfo@example.com" }, session: {} } as never,
    fakeDeps({
      claimLatestForTenant: async (userId: string, tenantId: string) => {
        seenArgs = [userId, tenantId];
        return { id: "batch-1", userId, tenantId, idea: "x", status: "completed", orgChart: null, costUsd: 0.01, error: null, createdAt: "", updatedAt: "" };
      },
    }),
  );

  const res = await app.request("/claim-org-chart", { method: "POST" });
  assert.equal(res.status, 200);
  assert.deepEqual(seenArgs, ["user-1", "tenant-1"]);
  const body = (await res.json()) as { batch: { id: string } };
  assert.equal(body.batch.id, "batch-1");
});

test("claim-org-chart returns a null batch, not an error, when there is nothing eligible to claim", async () => {
  const app = appWithSession(
    "tenant-1",
    { user: { id: "user-1", email: "cfo@example.com" }, session: {} } as never,
    fakeDeps({ claimLatestForTenant: async () => null }),
  );

  const res = await app.request("/claim-org-chart", { method: "POST" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { batch: null });
});

test("org-chart reads by the session's tenantId only", async () => {
  let seenTenantId: string | undefined;
  const app = appWithSession(
    "tenant-1",
    { user: { id: "user-1", email: "cfo@example.com" }, session: {} } as never,
    fakeDeps({
      latestForTenant: async (tenantId: string) => {
        seenTenantId = tenantId;
        return { id: "batch-1", userId: "user-1", tenantId, idea: "x", status: "completed", orgChart: null, costUsd: 0.01, error: null, createdAt: "", updatedAt: "" };
      },
    }),
  );

  const res = await app.request("/org-chart");
  assert.equal(res.status, 200);
  assert.equal(seenTenantId, "tenant-1");
});
