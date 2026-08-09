import { evaluateGateVerdict, type GateEvaluationInput, type GateVerdict } from "./gate.js";
import type { CeilingConfig } from "./ceilings.js";
import { ReservationLedger, UnknownReservationError, type Reservation } from "./reservations.js";
import type { DurableReservationStore } from "./durable/reservationStore.js";
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

// tenantId scopes every ceiling level (company/role/task-type) to ONE
// tenant's own pool, per issue #47 — "one single shared $50/month pool, not
// per-signup or per-tenant" was the bug. For pre-org signup flows there's
// no company yet (ADR-015), so callers pass the signing-up user's own id as
// this scoping key; post-org callers (the Router) pass the real tenantId.
// Either way it's just an opaque scope key to CostGate/the durable store.
export interface GateEvaluationRequest extends GateEvaluationInput {
  tenantId: string;
}

export interface GateEvaluationResult {
  verdict: GateVerdict;
  /** Present only for PROCEED/DOWNGRADE — QUEUE/SKIP never reserve budget
   *  that isn't about to be spent. */
  reservation?: Reservation;
}

// The stateful wrapper around the pure evaluateGateVerdict(): owns the
// durable reservation store, a per-tenant in-memory pre-check ledger, the
// audit log, and event emission.
//
// Two-tier reservation, both required by issue #47:
//   1. A per-tenant, in-process ReservationLedger (lazily created, one per
//      tenantId) feeds evaluateGateVerdict's existing pure estimate +
//      downgrade-tier logic UNCHANGED — this is a fast, best-effort local
//      pre-check, never the authority.
//   2. Whenever that pre-check says PROCEED or DOWNGRADE, the REAL
//      reservation goes through `store.reserveAtomic()` — the durable,
//      per-tenant, atomic store (packages/cost-gate/src/durable/
//      reservationStore.ts, already built and tested, previously unwired
//      into CostGate entirely). The durable store is authoritative: if it
//      disagrees with the local pre-check (a fresh process after a
//      restart, or concurrent spend from another replica, both cases the
//      old single-process in-memory ledger could never see), CostGate
//      downgrades the verdict to QUEUE/SKIP using the durable store's own
//      reason — this is what makes the ceiling a real cap over time
//      instead of "soft ... resets to $0 on every redeploy/restart."
//   A local pre-check that ALREADY says QUEUE/SKIP is trusted without a
//   durable round-trip: the local ledger only ever records reservations
//   the durable store already confirmed for this tenant, so it can safely
//   underestimate real spend but never overestimate it — a local "no" can
//   never be a false negative relative to the durable truth.
export class CostGate {
  private readonly listeners: GateEventListener[] = [];
  private readonly tenantLedgers = new Map<string, ReservationLedger>();
  // durable reservationId -> where to find/settle the mirrored local
  // reservation. Lets settle()/release() keep their existing single-arg
  // call sites (Router, runExtractionBatch.ts) unchanged — tenantId is
  // recovered here instead of being threaded through every call site.
  private readonly reservationMeta = new Map<string, { tenantId: string; localId: string }>();

  constructor(
    private readonly pricingTable: PricingTable,
    private readonly ceilingConfig: CeilingConfig,
    private readonly store: DurableReservationStore,
    private readonly modelMap: TierModelMap,
    private readonly audit: GateAuditLog = new InMemoryGateAuditLog(),
  ) {}

  onEvent(listener: GateEventListener): void {
    this.listeners.push(listener);
  }

  private emit(event: GateEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private ledgerFor(tenantId: string): ReservationLedger {
    let ledger = this.tenantLedgers.get(tenantId);
    if (!ledger) {
      ledger = new ReservationLedger();
      this.tenantLedgers.set(tenantId, ledger);
    }
    return ledger;
  }

  async evaluateAndReserve(input: GateEvaluationRequest): Promise<GateEvaluationResult> {
    const preCheck = evaluateGateVerdict(input, {
      pricingTable: this.pricingTable,
      ceilingConfig: this.ceilingConfig,
      ledger: this.ledgerFor(input.tenantId),
      modelMap: this.modelMap,
    });

    let verdict = preCheck;
    let reservation: Reservation | undefined;

    if (preCheck.kind === "PROCEED" || preCheck.kind === "DOWNGRADE") {
      const amountUsd = preCheck.estimate!.costUpperBoundUsd;
      const attempt = await this.store.reserveAtomic(
        { tenantId: input.tenantId, taskId: input.taskId, roleId: input.roleId, taskType: input.taskType, amountUsd },
        this.ceilingConfig,
      );

      if (attempt.withinCeiling && attempt.reservationId) {
        const local = this.ledgerFor(input.tenantId).reserve(input.roleId, input.taskType, amountUsd);
        this.reservationMeta.set(attempt.reservationId, { tenantId: input.tenantId, localId: local.id });
        reservation = {
          id: attempt.reservationId,
          roleId: input.roleId,
          taskType: input.taskType,
          amountUsd,
          createdAt: new Date().toISOString(),
          status: "reserved",
        };
      } else {
        // The durable store is authoritative and disagreed with the fast
        // local pre-check — downgrade the verdict the way the pre-check
        // would have if it had known what the durable store knows.
        verdict = input.batchable
          ? {
              kind: "QUEUE",
              reason: `Over ${attempt.exceededLevel} ceiling (durable check): ${attempt.detail}`,
              model: input.model,
              estimate: preCheck.estimate,
            }
          : {
              kind: "SKIP",
              reason: `Over ${attempt.exceededLevel} ceiling (durable check) and this task type isn't batchable: ${attempt.detail}`,
              model: input.model,
              estimate: preCheck.estimate,
            };
      }
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

  async settle(reservationId: string, actualCostUsd: number): Promise<void> {
    const meta = this.requireMeta(reservationId);
    await this.store.settle(meta.tenantId, reservationId, actualCostUsd);
    this.ledgerFor(meta.tenantId).settle(meta.localId, actualCostUsd);
    this.reservationMeta.delete(reservationId);
  }

  async release(reservationId: string): Promise<void> {
    const meta = this.requireMeta(reservationId);
    await this.store.release(meta.tenantId, reservationId);
    this.ledgerFor(meta.tenantId).release(meta.localId);
    this.reservationMeta.delete(reservationId);
  }

  private requireMeta(reservationId: string): { tenantId: string; localId: string } {
    const meta = this.reservationMeta.get(reservationId);
    if (!meta) throw new UnknownReservationError(`No reservation "${reservationId}".`);
    return meta;
  }

  auditEvents(): readonly GateAuditEvent[] {
    return this.audit.all();
  }
}
