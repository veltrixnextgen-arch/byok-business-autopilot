import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { AppEnv, AppSession } from "../context.js";
import { meRoute } from "./me.js";

function appWithSession(tenantId: string, session: AppSession) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", meRoute);
}

test("returns the authenticated user's id, email, and tenant from the session — not the request", async () => {
  const app = appWithSession("tenant-1", {
    user: { id: "user-1", email: "cfo@example.com" },
    session: {},
  } as never);

  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { userId: "user-1", email: "cfo@example.com", tenantId: "tenant-1" });
});
