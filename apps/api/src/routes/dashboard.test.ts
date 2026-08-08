import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { AppEnv } from "../context.js";
import { dashboardRoute } from "./dashboard.js";

function appWithTenant(tenantId: string, costActivity: { spendByRole: (...args: unknown[]) => Promise<unknown>; recentActivity: (...args: unknown[]) => Promise<unknown> }) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      await next();
    })
    .route("/dashboard", dashboardRoute({ costActivity: costActivity as never }));
}

test("reads spend and activity scoped to the context tenantId, ignoring any client-supplied tenant", async () => {
  const calls: unknown[] = [];
  const app = appWithTenant("tenant-from-session", {
    spendByRole: async (...args: unknown[]) => {
      calls.push({ method: "spendByRole", args });
      return [{ key: "cfo", totalUsd: 5 }];
    },
    recentActivity: async (...args: unknown[]) => {
      calls.push({ method: "recentActivity", args });
      return [];
    },
  });

  // A client-supplied tenantId in the query string must have no effect —
  // the route reads tenant scope only from context, never from the request.
  const res = await app.request("/dashboard?tenantId=someone-elses-tenant");

  assert.equal(res.status, 200);
  assert.equal(calls.length, 3, "spendByRole called twice (all-time, today) and recentActivity once");
  for (const call of calls as Array<{ args: unknown[] }>) {
    assert.equal(call.args[0], "tenant-from-session", "every query must use the context tenantId, never a client-supplied one");
  }

  const body = (await res.json()) as { spendByRoleAllTime: unknown; recentActivity: unknown };
  assert.deepEqual(body.spendByRoleAllTime, [{ key: "cfo", totalUsd: 5 }]);
  assert.deepEqual(body.recentActivity, []);
});

test("spend-today call passes a since date so it can only ever include today's reservations", async () => {
  const sinceArgs: Array<Date | undefined> = [];
  const app = appWithTenant("tenant-1", {
    spendByRole: async (...args: unknown[]) => {
      sinceArgs.push(args[1] as Date | undefined);
      return [];
    },
    recentActivity: async () => [],
  });

  await app.request("/dashboard");

  assert.equal(sinceArgs.length, 2);
  assert.equal(sinceArgs[0], undefined, "the all-time call passes no since bound");
  assert.ok(sinceArgs[1] instanceof Date, "the today call passes a since bound");
});
