import { evaluateGateVerdict, type GateEvaluationInput, type GateVerdict } from "./gate.js";
import type { CeilingConfig } from "./ceilings.js";
import { ReservationLedger, type Reservation } from "./reservations.js";
import type { PricingTable } from "./pricing.js";
import type { TierModelMap } from "./tierRouter.js";
import { InMemoryGateAuditLog, type GateAuditEvent, type GateAuditLog } from "./auditLog.js";

export type GateEvent = {
  type: "task.skipped";
  taskId: string;
  roleId: string;
  taskType: string;
  reason: string;
  at: string;
};

export type GateEventListener = (event: GateEvent) => void;

export interface GateEvaluationResult {
  verdict: GateVerdict;
  /** Present only for PROCEED/DOWNGRADE — QUEUE/SKIP never reserve budget
   *  that isn't about to be spent. */
  reservation?: Reservation;
}

// The stateful wrapper around the pure evaluateGateVerdict(): owns the
// reservation ledger, the audit log, and event emission. evaluateAndReserve
// is synchronous end-to-end (check ceilings -> reserve, no await between)
// so the reservation is atomic with the decision it's based on — see
// reservations.ts for why that's what actually prevents the ceiling race.
export class CostGate {
  private readonly listeners: GateEventListener[] = [];

  constructor(
    private readonly pricingTable: PricingTable,
    private readonly ceilingConfig: CeilingConfig,
    private readonly ledger: ReservationLedger,
    private readonly modelMap: TierModelMap,
    private readonly audit: GateAuditLog = new InMemoryGateAuditLog(),
  ) {}

  onEvent(listener: GateEventListener): void {
    this.listeners.push(listener);
  }

  private emit(event: GateEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  evaluateAndReserve(input: GateEvaluationInput): GateEvaluationResult {
    const verdict = evaluateGateVerdict(input, {
      pricingTable: this.pricingTable,
      ceilingConfig: this.ceilingConfig,
      ledger: this.ledger,
      modelMap: this.modelMap,
    });

    let reservation: Reservation | undefined;
    if ((verdict.kind === "PROCEED" || verdict.kind === "DOWNGRADE") && verdict.estimate) {
      reservation = this.ledger.reserve(input.roleId, input.taskType, verdict.estimate.costUpperBoundUsd);
    }

    this.audit.append({
      at: new Date().toISOString(),
      taskId: input.taskId,
      roleId: input.roleId,
      taskType: input.taskType,
      verdict: verdict.kind,
      reason: verdict.reason,
      model: verdict.model,
      downgradedTo: verdict.kind === "DOWNGRADE" ? verdict.model : undefined,
      estimatedUpperBoundUsd: verdict.estimate?.costUpperBoundUsd,
    });

    if (verdict.kind === "SKIP") {
      this.emit({
        type: "task.skipped",
        taskId: input.taskId,
        roleId: input.roleId,
        taskType: input.taskType,
        reason: verdict.reason,
        at: new Date().toISOString(),
      });
    }

    return { verdict, reservation };
  }

  settle(reservationId: string, actualCostUsd: number): void {
    this.ledger.settle(reservationId, actualCostUsd);
  }

  release(reservationId: string): void {
    this.ledger.release(reservationId);
  }

  auditEvents(): readonly GateAuditEvent[] {
    return this.audit.all();
  }
}
