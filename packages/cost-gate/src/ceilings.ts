import type { ReservationLedger } from "./reservations.js";

// Three levels, checked in this exact order (spec): company monthly, then
// per-role, then per-task-type. Each level's "spent" figure is actuals
// (settled) PLUS in-flight (reserved) — a reservation counts against the
// ceiling the instant it's made, not just once it settles, which is what
// prevents two nearly-simultaneous tasks from both fitting a
// nearly-exhausted budget.
export interface CeilingConfig {
  companyMonthlyUsd: number;
  perRoleUsd: Record<string, number>;
  perTaskTypeUsd: Record<string, number>;
  /** Per-taskType cap on spend for the current UTC day (durable/
   *  reservationStore.ts scopes the counter by `${taskType}:${day}`, so it
   *  resets on its own each day — no cron job needed). At the real
   *  scheduler dispatch call site (apps/router/src/router.ts) taskType IS
   *  the individual agent's id, so a populated entry here is a genuine
   *  per-agent-per-day ceiling — apps/api's trust-core wiring populates
   *  this from each agent's own `budget.perDayUsd` (Agent, @byok/contracts),
   *  itself a tier-derived default, not an informed per-agent value (see
   *  TIER_DEFAULT_BUDGET_PER_DAY_USD's own comment). Keyed the same way
   *  perTaskTypeUsd is; an absent key falls back to
   *  perTaskTypePerDayDefaultUsd below. */
  perTaskTypePerDayUsd?: Record<string, number>;
  /** Applied to any taskType with no entry in perTaskTypePerDayUsd above —
   *  onboarding-time task types (extraction-batch, website-summary) never
   *  have a per-agent entry, since they run before any org chart exists to
   *  draw one from. `null`/undefined means no day-level cap at all for
   *  those, matching how an absent key elsewhere means "uncapped." */
  perTaskTypePerDayDefaultUsd?: number | null;
}

export type CeilingLevel = "company" | "role" | "task-type" | "task-type-day";

export interface CeilingCheckResult {
  withinCeiling: boolean;
  exceededLevel?: CeilingLevel;
  detail?: string;
}

export function checkCeilings(
  additionalUsd: number,
  input: { roleId: string; taskType: string },
  config: CeilingConfig,
  ledger: ReservationLedger,
): CeilingCheckResult {
  const companyProjected = ledger.settledCompanyTotal() + ledger.reservedCompanyUsd() + additionalUsd;
  if (companyProjected > config.companyMonthlyUsd) {
    return {
      withinCeiling: false,
      exceededLevel: "company",
      detail: `Company monthly ceiling $${config.companyMonthlyUsd} would be exceeded: $${companyProjected.toFixed(4)} projected.`,
    };
  }

  const roleCeiling = config.perRoleUsd[input.roleId];
  if (roleCeiling !== undefined) {
    const roleProjected = ledger.settledRoleTotal(input.roleId) + ledger.reservedRoleUsd(input.roleId) + additionalUsd;
    if (roleProjected > roleCeiling) {
      return {
        withinCeiling: false,
        exceededLevel: "role",
        detail: `Role "${input.roleId}" ceiling $${roleCeiling} would be exceeded: $${roleProjected.toFixed(4)} projected.`,
      };
    }
  }

  const taskTypeCeiling = config.perTaskTypeUsd[input.taskType];
  if (taskTypeCeiling !== undefined) {
    const taskTypeProjected =
      ledger.settledTaskTypeTotal(input.taskType) + ledger.reservedTaskTypeUsd(input.taskType) + additionalUsd;
    if (taskTypeProjected > taskTypeCeiling) {
      return {
        withinCeiling: false,
        exceededLevel: "task-type",
        detail: `Task type "${input.taskType}" ceiling $${taskTypeCeiling} would be exceeded: $${taskTypeProjected.toFixed(4)} projected.`,
      };
    }
  }

  return { withinCeiling: true };
}
