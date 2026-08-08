import { Hono } from "hono";
import type { CostActivityQueries } from "@byok/router";
import type { AppEnv } from "../context.js";

/**
 * Pure read pass-through over the already-built, already-tenant-scoped
 * CostActivityQueries (apps/router/src/durable/queries.ts) — no new query
 * logic lives here. tenantId comes only from `c.get("tenantId")`, set by
 * tenantMiddleware from the server-verified session (security-architecture.md
 * Ring 1); there is no request input this route reads a tenant from, so a
 * caller has no path to another tenant's data regardless of what it sends.
 *
 * `since` for "today" is computed here only to choose which of
 * spendByRole's own supported arguments to call it with — not a new
 * aggregation. Real values are expected to be zero or near-zero right now
 * (no agents are running yet); that's correct, not a bug.
 */
function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function dashboardRoute(deps: { costActivity: CostActivityQueries }) {
  return new Hono<AppEnv>().get("/", async (c) => {
    const tenantId = c.get("tenantId");
    const [spendByRoleAllTime, spendByRoleToday, recentActivity] = await Promise.all([
      deps.costActivity.spendByRole(tenantId),
      deps.costActivity.spendByRole(tenantId, startOfTodayUtc()),
      deps.costActivity.recentActivity(tenantId, 20),
    ]);
    return c.json({ spendByRoleAllTime, spendByRoleToday, recentActivity });
  });
}
