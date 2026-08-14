import type { Cadence } from "@byok/contracts";

// R3 (docs/architecture/automation-runtime-plan.md §7, ADR-025): the
// minimum interval a sub-agent may be scheduled at, per tenant tier.
// Tier values are this product's REAL, shipped subscription tiers
// (apps/web/src/lib/pricingConstants.ts's PRICING_TIERS: solo/company/
// scale) — the plan doc's "Founder $29/Operator $79/Agency $199" naming
// doesn't exist anywhere in this codebase's actual pricing surface; see
// ADR-025 for the reconciliation. The floors themselves (daily -> hourly ->
// 15min, tightening as the tier goes up) are the plan's real intent,
// carried over unchanged.
export type TenantTier = "solo" | "company" | "scale";

export const CADENCE_FLOOR_BY_TIER: Record<TenantTier, Cadence> = {
  solo: "daily",
  company: "hourly",
  scale: "15min",
};

// Total order, fastest to slowest — needed to compare a declared cadence
// against a tier's floor. "nightly" sits between hourly and daily: it's a
// once-a-day batch, same standing frequency as "daily", just scheduled for
// an off-peak window rather than a fixed time of day — ranked equal to
// "daily" for floor-comparison purposes (neither is faster than the other).
const CADENCE_RANK: Record<Cadence, number> = {
  "15min": 0,
  hourly: 1,
  nightly: 2,
  daily: 2,
  weekly: 3,
  monthly: 4,
};

export interface ClampResult {
  cadence: Cadence;
  clamped: boolean;
  /** Present only when clamped=true — the plan's own example UI copy
   *  ("Runs daily on Founder — hourly available on Operator"), adapted to
   *  this codebase's real tier names. A visible upgrade path, not a silent
   *  degradation (plan §7's explicit requirement). */
  reason?: string;
}

const TIER_LABEL: Record<TenantTier, string> = { solo: "Solo", company: "Company", scale: "Scale" };

/**
 * Clamp at schedule time, not run time (plan §7 enforcement rule 1) — this
 * is called once, when a schedule is created/synced, never re-evaluated
 * per-firing. A schedule that violates the tier floor is rejected/rewritten
 * here, so the caller always knows their real cadence up front.
 */
export function clampCadenceToTierFloor(declared: Cadence, tier: TenantTier): ClampResult {
  const floor = CADENCE_FLOOR_BY_TIER[tier];
  if (CADENCE_RANK[declared] >= CADENCE_RANK[floor]) {
    return { cadence: declared, clamped: false };
  }
  const nextTier = (Object.entries(CADENCE_FLOOR_BY_TIER) as [TenantTier, Cadence][]).find(
    ([, f]) => CADENCE_RANK[f] <= CADENCE_RANK[declared],
  )?.[0];
  return {
    cadence: floor,
    clamped: true,
    reason: nextTier
      ? `Runs ${floor} on ${TIER_LABEL[tier]} — ${declared} available on ${TIER_LABEL[nextTier]}.`
      : `Runs ${floor} on ${TIER_LABEL[tier]}.`,
  };
}
