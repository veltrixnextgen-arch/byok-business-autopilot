import type { CompanyCharterStore, SignupExtractionBatchStore } from "@byok/db";
import { syncTenantSchedule, type RepeatableQueueLike, type TenantTier } from "@byok/jobs";
import { computeDesiredSchedule, type ClampNote } from "./computeDesiredSchedule.js";

export interface ApplyTierChangeDeps {
  setTenantTier: (tenantId: string, tier: TenantTier) => Promise<void>;
  charters: Pick<CompanyCharterStore, "getActive">;
  batchStore: Pick<SignupExtractionBatchStore, "latestForTenant">;
  queue: RepeatableQueueLike;
  jobName: string;
}

export interface ApplyTierChangeResult {
  tier: TenantTier;
  resynced: boolean;
  added: string[];
  removed: string[];
  unchanged: string[];
  clampNotes: ClampNote[];
}

/**
 * Persists a tenant's tier and re-syncs its schedule to the new cadence
 * floor — the exact logic `POST /me/tier` used to inline directly.
 * Extracted (issue #18/ADR-045) so the Stripe webhook can call the same
 * path a tier change already used, rather than duplicating it or the
 * webhook reaching into tier.ts's route internals. tier.ts's own public
 * mutation route is gone (see that file's comment) — this function has
 * exactly one real caller now (routes/billing.ts's webhook handler), but
 * stays its own module rather than folding into billing.ts, since "what
 * a tier change does" is a scheduler concern, not a billing one.
 */
export async function applyTierChange(deps: ApplyTierChangeDeps, tenantId: string, tier: TenantTier): Promise<ApplyTierChangeResult> {
  await deps.setTenantTier(tenantId, tier);

  const [charter, batch] = await Promise.all([deps.charters.getActive(tenantId), deps.batchStore.latestForTenant(tenantId)]);
  if (!charter?.cascade || !batch?.orgChart) {
    // Nothing claimed/installed yet to schedule from — a real, common
    // case for a brand-new paying tenant who hasn't finished onboarding.
    // Not an error: the eventual Charter-accept sync picks up whatever
    // tier is set by then, same as tier.ts's own original reasoning.
    return { tier, resynced: false, added: [], removed: [], unchanged: [], clampNotes: [] };
  }

  const { desired, clampNotes } = computeDesiredSchedule(tenantId, tier, batch.orgChart);
  const result = await syncTenantSchedule(deps.queue, deps.jobName, tenantId, desired);
  return { tier, resynced: true, ...result, clampNotes };
}
