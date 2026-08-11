import { zValidator } from "@hono/zod-validator";
import { InvalidCeilingError, type TenantCeilingStore } from "@byok/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";

export interface CeilingRouteDeps {
  ceilings: Pick<TenantCeilingStore, "get" | "set">;
}

/** The platform default a tenant falls back to until it sets its own
 *  override (issue #15's safety-net step). Defined here (not
 *  dev/devTrustCore.ts) because it's a real product constant this route
 *  always needs, not a dev-only wiring detail — devTrustCore.ts's
 *  ceilingResolver imports it FROM here instead, so it can't drift out of
 *  sync with what this route actually reports as the default. */
export const DEFAULT_MONTHLY_CEILING_USD = 50;

const setCeilingSchema = z.object({
  companyMonthlyUsd: z.number().positive().finite(),
});

/**
 * The safety-net step's durable half (issue #15, roles-and-api-key-guide.md
 * Part 3's "2-tap safety net" — our monthly ceiling, prefilled and
 * editable). GET always returns a value (the tenant's own override if set,
 * else the platform default) so the UI never has to special-case "nothing
 * set yet" — `isOverride` tells it whether the number came from the tenant
 * or the platform. CostGate's own ceilingResolver (devTrustCore.ts) reads
 * through this SAME TenantCeilingStore, so what a tenant sets here
 * genuinely gates its spend, not just a UI-only preference.
 */
export function ceilingRoute(deps: CeilingRouteDeps) {
  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const tenantId = c.get("tenantId");
      const override = await deps.ceilings.get(tenantId);
      return c.json({
        companyMonthlyUsd: override ?? DEFAULT_MONTHLY_CEILING_USD,
        isOverride: override !== null,
      });
    })
    .post("/", zValidator("json", setCeilingSchema), async (c) => {
      const { companyMonthlyUsd } = c.req.valid("json");
      const tenantId = c.get("tenantId");
      try {
        await deps.ceilings.set(tenantId, companyMonthlyUsd);
      } catch (err) {
        if (err instanceof InvalidCeilingError) return c.json({ error: err.message }, 400);
        throw err;
      }
      return c.json({ companyMonthlyUsd, isOverride: true });
    });
}
