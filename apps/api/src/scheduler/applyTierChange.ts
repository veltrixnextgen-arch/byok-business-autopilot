import type { CompanyCharterStore, SignupExtractionBatchStore } from "@byok/db";
import { syncTenantSchedule, type RepeatableQueueLike } from "@byok/jobs";
import { computeDesiredSchedule, type ClampNote } from "./computeDesiredSchedule.js";

export interface ApplyTierChangeDeps {
  setTenantTier: (tenantId: string, tier: "solo") => Promise<void>;
  charters: Pick<CompanyCharterStore, "getActive">;
  batchStore: Pick<SignupExtractionBatchStore, "latestForTenant">;
  queue: RepeatableQueueLike;
  jobName: string;
}

export interface ApplyTierChangeResult {
  resynced: boolean;
  added: string[];
  removed: string[];
  unchanged: string[];
  clampNotes: ClampNote[];
}

/**
 * ADR-057: one plan now, so this no longer changes WHICH tier a tenant is
 * on (there's only ever "solo") — it re-syncs the schedule after a
 * subscription starts or ends, the same re-sync `POST /me/tier` used to
 * inline directly before issue #18/ADR-045 extracted it. `tenants.tier`
 * stays written as 'solo' unconditionally (the column's own CHECK
 * constraint now only allows that value — see docs/DECISIONS.md ADR-057)
 * rather than removed outright, so a future re-differentiation doesn't
 * need a second migration just to bring the column back.
 */
export async function applyTierChange(deps: ApplyTierChangeDeps, tenantId: string): Promise<ApplyTierChangeResult> {
  await deps.setTenantTier(tenantId, "solo");

  const [charter, batch] = await Promise.all([deps.charters.getActive(tenantId), deps.batchStore.latestForTenant(tenantId)]);
  if (!charter?.cascade || !batch?.orgChart) {
    // Nothing claimed/installed yet to schedule from — a real, common
    // case for a brand-new paying tenant who hasn't finished onboarding.
    // Not an error: the eventual Charter-accept sync picks up the schedule
    // once that happens.
    return { resynced: false, added: [], removed: [], unchanged: [], clampNotes: [] };
  }

  const { desired, clampNotes } = computeDesiredSchedule(tenantId, batch.orgChart);
  const result = await syncTenantSchedule(deps.queue, deps.jobName, tenantId, desired);
  return { resynced: true, ...result, clampNotes };
}
