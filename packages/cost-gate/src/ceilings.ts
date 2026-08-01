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
}

export type CeilingLevel = "company" | "role" | "task-type";

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
