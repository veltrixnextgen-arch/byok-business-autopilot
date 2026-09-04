import { evaluateGateVerdict, type GateEvaluationInput, type GateVerdict, type TierModelMapsByProvider } from "./gate.js";
import type { CeilingConfig } from "./ceilings.js";
import { ReservationLedger, UnknownReservationError, type Reservation } from "./reservations.js";
import type { DurableReservationStore } from "./durable/reservationStore.js";
import type { PricingTable } from "./pricing.js";
import { isDevOrTestEnvironment } from "@byok/vault";
import { InMemoryDurableAuditLog, type DurableAuditLog, type StoredAuditEvent } from "@byok/db";

export type GateEvent = {
  type: "task.skipped";
  taskId: string;
  roleId: string;
  taskType: string;
  reason: string;
  at: string;
};

export type GateEventListener = (event: GateEvent) => void;

// Issue #15's safety net: "our monthly ceiling ... editable" needs a real
// per-tenant value, not the single process-wide CeilingConfig every tenant
// used to share. A resolver function is the smallest change that supports
// that without CostGate itself gaining a DB dependency — callers that own
// persistence (e.g. apps/api's devTrustCore.ts, backed by
// @byok/db's TenantCeilingStore) supply one; callers that don't need
// per-tenant overrides keep passing a plain CeilingConfig, unchanged.
export type CeilingConfigResolver = (tenantId: string) => CeilingConfig | Promise<CeilingConfig>;

// #150: CostGate's own decision trail (every evaluateAndReserve verdict —
// distinct from the reservation-level events PostgresReservationStore
// already writes to the shared audit_log table) used to be a bespoke,
// always-in-memory GateAuditLog with no durable counterpart. It's now the
// same shared, tenant-scoped DurableAuditLog every other trust-core audit
// trail writes through (source="cost-gate") — durableTrustCore.ts passes a
// real PostgresDurableAuditLog for any deployed environment. Same guard
// reasoning as Vault's own (packages/vault/src/vault.ts) — an omitted
// `audit` argument outside dev/test would otherwise silently default to an
// in-memory instance whose trail vanishes on the next restart.
export class DevOnlyCostGateAuditGuardError extends Error {}

function defaultAuditLog(): DurableAuditLog {
  if (!isDevOrTestEnvironment()) {
    throw new DevOnlyCostGateAuditGuardError(
      "CostGate cannot default its audit log to an in-memory store outside a dev or test environment — " +
        "pass a real DurableAuditLog (e.g. PostgresDurableAuditLog) for any deployed environment.",
    );
  }
  return new InMemoryDurableAuditLog();
}

// One company per user (2026-09-03): the deepest fail-closed layer for
// both the multi-org gap (a tenant a user has switched away from) and
// the pre-existing, separate gap billing.ts's own comment flagged
// (nothing anywhere gated spend on having an active subscription at
// all) — one check closes both, since a tenant that fails either
// condition must never reserve budget, regardless of what happens
// upstream (a stale scheduler job, a route that forgot its own guard).
// A resolver function, not a concrete @byok/db dependency — same
// reasoning as CeilingConfigResolver: CostGate stays DB-agnostic;
// durableTrustCore.ts supplies the real check (ActiveTenantStore +
// tenants.stripe_subscription_id).
export interface TenantEligibility {
  eligible: boolean;
  /** Surfaced in the SKIP verdict's reason and the audit trail — only
   *  meaningful when eligible is false. */
  reason?: string;
}

export type TenantEligibilityResolver = (tenantId: string) => Promise<TenantEligibility> | TenantEligibility;

export class DevOnlyCostGateEligibilityGuardError extends Error {}

function defaultTenantEligibility(): TenantEligibilityResolver {
  if (!isDevOrTestEnvironment()) {
    throw new DevOnlyCostGateEligibilityGuardError(
      "CostGate cannot default every tenant to eligible outside a dev or test environment — pass a real " +
        "TenantEligibilityResolver (active-company + subscription check) for any deployed environment.",
    );
  }
  return () => ({ eligible: true });
}

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

  private readonly audit: DurableAuditLog;
  private readonly tenantEligibility: TenantEligibilityResolver;

  constructor(
    private readonly pricingTable: PricingTable,
    private readonly ceilingConfig: CeilingConfig | CeilingConfigResolver,
    private readonly store: DurableReservationStore,
    private readonly modelMaps: TierModelMapsByProvider,
    audit?: DurableAuditLog,
    tenantEligibility?: TenantEligibilityResolver,
  ) {
    this.audit = audit ?? defaultAuditLog();
    this.tenantEligibility = tenantEligibility ?? defaultTenantEligibility();
  }

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

  private async resolveCeilingConfig(tenantId: string): Promise<CeilingConfig> {
    return typeof this.ceilingConfig === "function" ? await this.ceilingConfig(tenantId) : this.ceilingConfig;
  }

  async evaluateAndReserve(input: GateEvaluationRequest): Promise<GateEvaluationResult> {
    const eligibility = await this.tenantEligibility(input.tenantId);
    if (!eligibility.eligible) {
      const verdict: GateVerdict = {
        kind: "SKIP",
        reason: eligibility.reason ?? "Tenant is not eligible to spend.",
        model: input.model,
      };
      await this.audit.append({
        tenantId: input.tenantId,
        source: "cost-gate",
        kind: verdict.kind,
        refId: input.taskId,
        detail: { roleId: input.roleId, taskType: input.taskType, reason: verdict.reason },
      });
      this.emit({
        type: "task.skipped",
        taskId: input.taskId,
        roleId: input.roleId,
        taskType: input.taskType,
        reason: verdict.reason,
        at: new Date().toISOString(),
      });
      return { verdict };
    }

    const ceilingConfig = await this.resolveCeilingConfig(input.tenantId);
    const preCheck = evaluateGateVerdict(input, {
      pricingTable: this.pricingTable,
      ceilingConfig,
      ledger: this.ledgerFor(input.tenantId),
      modelMaps: this.modelMaps,
    });

    let verdict = preCheck;
    let reservation: Reservation | undefined;

    if (preCheck.kind === "PROCEED" || preCheck.kind === "DOWNGRADE") {
      const amountUsd = preCheck.estimate!.costUpperBoundUsd;
      const attempt = await this.store.reserveAtomic(
        { tenantId: input.tenantId, taskId: input.taskId, roleId: input.roleId, taskType: input.taskType, amountUsd },
        ceilingConfig,
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

    await this.audit.append({
      tenantId: input.tenantId,
      source: "cost-gate",
      kind: verdict.kind,
      refId: input.taskId,
      detail: {
        roleId: input.roleId,
        taskType: input.taskType,
        reason: verdict.reason,
        model: verdict.model,
        downgradedTo: verdict.kind === "DOWNGRADE" ? verdict.model : undefined,
        estimatedUpperBoundUsd: verdict.estimate?.costUpperBoundUsd,
      },
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

  /** tenantId-scoped, most-recent-first — mirrors DurableAuditLog.recentForTenant
   *  exactly (no wider "every tenant" read exists, matching every other
   *  durable store in this codebase, and RLS would refuse one anyway). */
  async auditEvents(tenantId: string, limit?: number): Promise<readonly StoredAuditEvent[]> {
    return this.audit.recentForTenant(tenantId, limit);
  }
}
