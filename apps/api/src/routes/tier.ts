import { zValidator } from "@hono/zod-validator";
import type { CompanyCharterStore, SignupExtractionBatchStore } from "@byok/db";
import { syncTenantSchedule, type RepeatableQueueLike, type TenantTier } from "@byok/jobs";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { computeDesiredSchedule } from "../scheduler/computeDesiredSchedule.js";

export interface TierRouteDeps {
  getTenantTier: (tenantId: string) => Promise<TenantTier>;
  setTenantTier: (tenantId: string, tier: TenantTier) => Promise<void>;
  charters: Pick<CompanyCharterStore, "getActive">;
  batchStore: Pick<SignupExtractionBatchStore, "latestForTenant">;
  queue: RepeatableQueueLike;
  jobName: string;
}

const setTierSchema = z.object({
  // The three real, shipped tiers (apps/web/src/lib/pricingConstants.ts)
  // — same reconciliation ADR-025 already did for the scheduler's own
  // cadence-floor map. No "Founder/Operator/Agency" naming here either.
  tier: z.enum(["solo", "company", "scale"]),
});

/**
 * A tenant's own tier had no mutation path at all before this — genuinely
 * missing, not merely untested: upgrading from Solo to Company was
 * impossible for any real tenant, not just this session's test one.
 *
 * SECURITY NOTE, not yet addressed here: this is billing-adjacent (a
 * tenant's tier determines what they're charged and what cadence floor
 * gates their unattended spend) and T6's step-up-auth concept
 * (security-architecture.md, packages/auth/src/stepUp.ts) already lists
 * a sibling `"ceiling_change"` operation for exactly this class of
 * mutation — but `ceilingRoute` itself isn't gated by
 * `requireStepUp("ceiling_change")` today either, so this joins an
 * existing, known gap rather than opening a new one. A future
 * `"tier_change"` STEP_UP_OPERATIONS entry (or reusing
 * `"ceiling_change"`) plus wiring `requireStepUp` onto this route is
 * required before this is reachable with real billing behind it — not
 * built here, since the step-up UI/verification flow itself doesn't
 * exist yet either (same gap `requireStepUp`'s own doc comment already
 * flags).
 */
export function tierRoute(deps: TierRouteDeps) {
  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const tenantId = c.get("tenantId");
      const tier = await deps.getTenantTier(tenantId);
      return c.json({ tier });
    })
    .post("/", zValidator("json", setTierSchema), async (c) => {
      const { tier } = c.req.valid("json");
      const tenantId = c.get("tenantId");
      await deps.setTenantTier(tenantId, tier);

      // Re-clamps every existing schedule to the new tier's cadence floor
      // immediately, in both directions — reuses the exact mechanism
      // Charter acceptance already triggers (computeDesiredSchedule +
      // syncTenantSchedule), per scheduler.ts's own comment anticipating
      // this call site. A downgrade (e.g. scale -> solo) re-clamps
      // schedules that were running faster than solo's floor permits;
      // an upgrade lets them run at whatever their declared cadence (or
      // the new, looser floor) actually allows — computeDesiredSchedule
      // recomputes desired state fresh from the tier passed in, it
      // doesn't matter which direction the change went.
      const [charter, batch] = await Promise.all([deps.charters.getActive(tenantId), deps.batchStore.latestForTenant(tenantId)]);
      if (!charter?.cascade || !batch?.orgChart) {
        // Nothing claimed/installed yet to schedule from — the eventual
        // Charter-accept sync picks up whatever tier is set by then,
        // same as any other first-time sync. Not an error: a tenant can
        // legitimately set their tier before ever finishing onboarding.
        return c.json({ tier, resynced: false });
      }

      const { desired, clampNotes } = computeDesiredSchedule(tenantId, tier, batch.orgChart);
      const result = await syncTenantSchedule(deps.queue, deps.jobName, tenantId, desired);
      return c.json({ tier, resynced: true, ...result, clampNotes });
    });
}
