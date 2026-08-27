import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
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

test("GET / reports the tenant's current tier", async () => {
  const app = appWithSession("tenant-1", SESSION, { getTenantTier: async () => "company" });

  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { tier: "company" });
});

test("GET / has no mutation path — POST is not a route on this app at all", async () => {
  const app = appWithSession("tenant-1", SESSION, { getTenantTier: async () => "solo" });

  const res = await app.request("/", { method: "POST" });
  assert.equal(res.status, 404);
});
