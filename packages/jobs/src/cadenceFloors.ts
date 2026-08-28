import type { Cadence } from "@byok/contracts";

// R3 (docs/architecture/automation-runtime-plan.md §7, ADR-057): one
// plan now, so one floor for every tenant — no more per-tier
// differentiation. Daily was chosen from the plan's own modeled COGS
// range ($3.59-$9.39/company/month): against the single $39/month price,
// that's 9-24% of revenue, the low end comfortably under the plan's own
// "COGS over 20% of price means the floor is wrong" standing rule and
// the high end only marginally over it — Hourly or 15-minute floors
// would blow well past that threshold for every tenant now that there's
// no higher-priced tier to absorb the higher run volume. Revisit once R3's
// real instrumentation (scheduler_instrumentation_daily) has enough
// measured data to confirm or correct this modeled estimate.
export const CADENCE_FLOOR: Cadence = "daily";

// Total order, fastest to slowest — needed to compare a declared cadence
// against the floor. "nightly" sits between hourly and daily: it's a
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
  /** Present only when clamped=true — a visible message, not a silent
   *  degradation (plan §7's explicit requirement). No upgrade path to
   *  name anymore (one plan, one floor), so this just states the floor. */
  reason?: string;
}

/**
 * Clamp at schedule time, not run time (plan §7 enforcement rule 1) — this
 * is called once, when a schedule is created/synced, never re-evaluated
 * per-firing. A schedule that violates the floor is rejected/rewritten
 * here, so the caller always knows their real cadence up front.
 */
export function clampCadenceToFloor(declared: Cadence): ClampResult {
  if (CADENCE_RANK[declared] >= CADENCE_RANK[CADENCE_FLOOR]) {
    return { cadence: declared, clamped: false };
  }
  return { cadence: CADENCE_FLOOR, clamped: true, reason: `Runs ${CADENCE_FLOOR}.` };
}
