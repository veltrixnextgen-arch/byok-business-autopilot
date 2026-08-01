import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { AppEnv } from "../context.js";
import { tasksRoute } from "./tasks.js";

function appWithTenant(tenantId: string, router: { submitTask: (input: unknown) => Promise<unknown> }) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      await next();
    })
    .route("/tasks", tasksRoute({ router: router as never }));
}

test("submits through router.submitTask; tenantId comes from context, not the request body", async () => {
  const calls: unknown[] = [];
  const app = appWithTenant("tenant-from-session", {
    submitTask: async (input) => {
      calls.push(input);
      return { id: "task-1", status: "pending" };
    },
  });

  const res = await app.request("/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subAgentId: "invoicing",
      teamId: "cfo",
      title: "Draft invoice",
      payload: "...",
      dedupKey: "dk-1",
    }),
  });

  assert.equal(res.status, 201);
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { tenantId: string }).tenantId, "tenant-from-session");
});

test("rejects an invalid body with 400 before ever calling the router", async () => {
  const app = appWithTenant("tenant-1", {
    submitTask: async () => {
      throw new Error("router must not be called for an invalid request");
    },
  });

  const res = await app.request("/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subAgentId: "" }),
  });

  assert.equal(res.status, 400);
});
