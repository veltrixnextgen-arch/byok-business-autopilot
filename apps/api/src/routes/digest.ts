import { Hono } from "hono";
import type { AppEnv } from "../context.js";
import { buildDigestData, type DigestDeps } from "../digest/buildDigestData.js";

/**
 * Same aggregation function the scheduled email job uses
 * (sendDailyDigests.ts) — the in-app digest and the email can never show
 * different numbers for the same day, because there's only one code path
 * that computes "today's digest" for a tenant.
 */
export function digestRoute(deps: DigestDeps) {
  return new Hono<AppEnv>().get("/", async (c) => {
    const tenantId = c.get("tenantId");
    const digest = await buildDigestData(deps, tenantId);
    return c.json({ digest });
  });
}
