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
  /** Flat cap applied to every taskType's spend for the current UTC day
   *  (durable/reservationStore.ts scopes the counter by `${taskType}:${day}`,
   *  so it resets on its own each day — no cron job needed). At the real
   *  scheduler dispatch call site (apps/router/src/router.ts) taskType IS
   *  the individual agent's id, so this is what "per-agent per-day" cashes
   *  out to today. Flat rather than per-key: no per-agent budget value
   *  exists anywhere in the codebase yet (Agent has no `budget` field —
   *  see docs/strategy/runwisely-master-vision.md §9) to seed a map from.
   *  `null`/undefined means no day-level cap, matching how an absent key in
   *  perRoleUsd/perTaskTypeUsd already means "uncapped at that level." */
  perTaskTypePerDayUsd?: number | null;
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
