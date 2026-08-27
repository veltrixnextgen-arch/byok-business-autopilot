import type { TenantTier } from "@byok/jobs";
import { Hono } from "hono";
import type { AppEnv } from "../context.js";

export interface TierRouteDeps {
  getTenantTier: (tenantId: string) => Promise<TenantTier>;
}

/**
 * Read-only. `POST /` used to let a signed-in tenant set their own tier
 * directly, no payment involved — genuinely fine while tier was purely a
 * cadence-floor knob, but issue #18/ADR-045 attached a real price to
 * every tier (Solo $39/mo and up), and nothing else changed to stop a
 * free call from claiming Scale at $249/mo. Removed rather than gated:
 * no UI ever called it (confirmed before removing it, not assumed), so
 * there's nothing to migrate. `applyTierChange`
 * (apps/api/src/scheduler/applyTierChange.ts) carries the exact same
 * persist + re-sync logic this route used to inline — the Stripe
 * webhook (routes/billing.ts) is its one real caller now.
 */
export function tierRoute(deps: TierRouteDeps) {
  return new Hono<AppEnv>().get("/", async (c) => {
    const tenantId = c.get("tenantId");
    const tier = await deps.getTenantTier(tenantId);
    return c.json({ tier });
  });
}
