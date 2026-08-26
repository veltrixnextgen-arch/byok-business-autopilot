import type { AutonomyEvent } from "./autonomyEngine.js";
import type { EffectExecutor, EffectResult } from "./effectExecutor.js";
import { InMemoryQueueAuditLog, type QueueAuditEvent, type QueueAuditLog } from "./auditLog.js";
import { InMemoryDurableApprovalStore, type DurableApprovalStore } from "./durable/approvalStore.js";
import type { DurableAutonomyStore } from "./durable/autonomyStore.js";
import { EffectOnRecommendationError, type ProposedAction, type RecommendationItem, type Verdict } from "./types.js";

export type QueueEvent =
  | { type: "action.queued"; actionId: string; tenantId: string; taskType: string; at: string }
  | { type: "action.auto-approved"; actionId: string; tenantId: string; taskType: string; at: string }
  | { type: "agent.learning"; actionId: string; tenantId: string; taskType: string; feedback: string; at: string }
  | { type: "recommendation.guidance"; actionId: string; tenantId: string; verdictKind: Verdict["kind"]; at: string }
  | AutonomyEvent;

export type QueueEventListener = (event: QueueEvent) => void;

export interface SubmitResult {
  /** false only when earned autonomy bypassed human review entirely. */
  queued: boolean;
  effectResult?: EffectResult;
}

export interface ResolveResult {
  dispatched: boolean;
  effectResult?: EffectResult;
}

// "Every agent action lands here before it's visible as 'done'" (issue #9)
// — submitProposedAction() is the ONLY path by which an action's effect
// can ever run, and even the bypass path (earned autonomy) still logs and
// still dispatches through the same effectExecutor, never a shortcut that
// skips this class.
export class ApprovalQueue {
  private readonly listeners: QueueEventListener[] = [];

  constructor(
    // Async DurableAutonomyStore, not the old synchronous AutonomyEngine —
    // this is what closed the accept-offer split-brain: previously,
    // accepting an autonomy offer (apps/api/src/routes/approvals.ts) wrote
    // `active = true` to a real Postgres row that this class never read,
    // because live dispatch gating (submitProposedAction below) checked a
    // completely separate, in-memory AutonomyEngine that reset on every
    // restart. Now there is exactly one autonomy store; whatever
    // `approvals.ts` accepts, submitProposedAction sees.
    //
    // The durable store has no event-emission mechanism of its own (unlike
    // AutonomyEngine, which called `this.emit(...)` internally from
    // recordApproval/recordSpotCheckRejection/revoke) — every AutonomyEvent
    // below is synthesized here, right after the awaited call that used to
    // trigger it synchronously.
    public readonly autonomy: DurableAutonomyStore,
    private readonly effectExecutor: EffectExecutor,
    private readonly audit: QueueAuditLog = new InMemoryQueueAuditLog(),
    // ADR-026: pending-item state used to live in two plain in-memory Maps
    // here — real per T10's queuing behavior, but gone on restart, and
    // with no way for anything outside this process to ever see a pending
    // item. `store` is the durable, tenant-scoped counterpart
    // (packages/approval-queue/src/durable/approvalStore.ts) — Postgres
    // for any deployed environment, in-memory only for tests/local dev.
    // `audit` above is unrelated and unchanged: a separate, lightweight,
    // in-process event trail this class has always kept for its own
    // listeners, not the durable audit_log row PostgresDurableApprovalStore
    // writes internally.
    private readonly store: DurableApprovalStore = new InMemoryDurableApprovalStore(),
  ) {}

  onEvent(listener: QueueEventListener): void {
    this.listeners.push(listener);
  }

  private emit(event: QueueEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async submitProposedAction(action: ProposedAction): Promise<SubmitResult> {
    const autonomyActive = (await this.autonomy.isActive(action.tenantId, action.taskType)) && !this.autonomy.isDeniable(action.stakesTags);

    if (autonomyActive && !this.autonomy.shouldSpotCheck()) {
      // Bypass: no human review. Still dispatches through the SAME
      // effectExecutor, still fully audited — just no pending queue entry.
      const effectResult = action.effect ? await this.effectExecutor.execute(action.effect, action) : undefined;
      const at = new Date().toISOString();
      this.audit.append({
        at,
        actionId: action.id,
        tenantId: action.tenantId,
        taskType: action.taskType,
        kind: "auto-approved",
        detail: action.effect ? `effect=${action.effect.kind}` : undefined,
      });
      this.emit({ type: "action.auto-approved", actionId: action.id, tenantId: action.tenantId, taskType: action.taskType, at });
      return { queued: false, effectResult };
    }

    // Spot-check-ness travels with the stored item now (store.resolve
    // returns it back in ResolveOutcome) rather than a parallel local Set
    // that could drift from `pending` under a crash between the two writes.
    const isSpotCheck = autonomyActive;
    await this.store.submitProposedAction(action, isSpotCheck);
    const at = new Date().toISOString();
    this.audit.append({ at, actionId: action.id, tenantId: action.tenantId, taskType: action.taskType, kind: "queued" });
    this.emit({ type: "action.queued", actionId: action.id, tenantId: action.tenantId, taskType: action.taskType, at });
    return { queued: true };
  }

  async resolve(tenantId: string, actionId: string, verdict: Verdict): Promise<ResolveResult> {
    const { action, wasSpotCheck: isSpotCheck } = await this.store.resolve(tenantId, actionId, verdict);

    const at = () => new Date().toISOString();

    if (verdict.kind === "REJECT") {
      this.emit({
        type: "agent.learning",
        actionId,
        tenantId: action.tenantId,
        taskType: action.taskType,
        feedback: verdict.feedback,
        at: at(),
      });
      if (isSpotCheck) {
        await this.autonomy.recordSpotCheckRejection(action.tenantId, action.taskType);
        // AutonomyEngine.recordSpotCheckRejection used to emit this
        // internally — synthesized here now, right after the store write
        // it used to accompany atomically in-process.
        this.emit({
          type: "autonomy.revoked",
          tenantId: action.tenantId,
          taskType: action.taskType,
          reason: "spot-check-rejected",
          at: at(),
        });
      } else {
        await this.autonomy.recordRejection(action.tenantId, action.taskType);
      }
      this.audit.append({
        at: at(),
        actionId,
        tenantId: action.tenantId,
        taskType: action.taskType,
        kind: "REJECT",
        detail: verdict.feedback,
      });
      return { dispatched: false };
    }

    const finalAction: ProposedAction = verdict.kind === "MODIFY" ? { ...action, draft: verdict.editedOutput } : action;

    const effectResult = finalAction.effect ? await this.effectExecutor.execute(finalAction.effect, finalAction) : undefined;

    // Both APPROVE and MODIFY are the "approve-path" per spec — earned
    // autonomy progresses on either.
    const { offered, consecutiveApprovals } = await this.autonomy.recordApproval(action.tenantId, action.taskType, action.stakesTags);
    // AutonomyEngine.recordApproval used to emit this internally the
    // instant the threshold was crossed — synthesized here now, from the
    // store's return value.
    if (offered) {
      this.emit({
        type: "autonomy.offered",
        tenantId: action.tenantId,
        taskType: action.taskType,
        consecutiveApprovals,
        at: at(),
      });
    }

    this.audit.append({
      at: at(),
      actionId,
      tenantId: action.tenantId,
      taskType: action.taskType,
      kind: verdict.kind,
      detail: finalAction.effect ? `effect=${finalAction.effect.kind}` : undefined,
    });

    return { dispatched: !!finalAction.effect, effectResult };
  }

  // ---- CEO pathway (T10 / ADR-004) --------------------------------------

  async submitRecommendation(item: RecommendationItem): Promise<void> {
    // Defense in depth: the type has no `effect` field, but nothing stops
    // a caller from smuggling one in via `as any`. Reject it at runtime too.
    if ("effect" in (item as unknown as Record<string, unknown>)) {
      throw new EffectOnRecommendationError(
        "A RecommendationItem can never carry an effect descriptor (T10) — the CEO's only output pathway is guidance.",
      );
    }
    await this.store.submitRecommendation(item);
    this.audit.append({
      at: new Date().toISOString(),
      actionId: item.id,
      tenantId: item.tenantId,
      kind: "recommendation-submitted",
    });
  }

  /** Verdicts on a recommendation NEVER dispatch anything — there is no
   *  effect to dispatch. This only emits a guidance event for whatever
   *  downstream system (e.g. "fold this into next week's digest context")
   *  wants to react to it. */
  async resolveRecommendation(tenantId: string, id: string, verdict: Verdict): Promise<void> {
    const item = await this.store.resolveRecommendation(tenantId, id);

    const at = new Date().toISOString();
    this.emit({ type: "recommendation.guidance", actionId: id, tenantId: item.tenantId, verdictKind: verdict.kind, at });
    this.audit.append({
      at,
      actionId: id,
      tenantId: item.tenantId,
      kind: "recommendation-resolved",
      detail: verdict.kind === "REJECT" ? verdict.feedback : undefined,
    });
  }

  // ---- reads --------------------------------------------------------------

  async pendingActions(tenantId: string): Promise<readonly ProposedAction[]> {
    return this.store.pendingActions(tenantId);
  }

  async pendingRecommendationItems(tenantId: string): Promise<readonly RecommendationItem[]> {
    return this.store.pendingRecommendations(tenantId);
  }

  auditEvents(): readonly QueueAuditEvent[] {
    return this.audit.all();
  }

  async revokeAutonomy(tenantId: string, taskType?: string): Promise<void> {
    const { revokedTaskTypes } = await this.autonomy.revoke(tenantId, taskType);
    const at = new Date().toISOString();
    // AutonomyEngine.revoke used to emit one autonomy.revoked event per
    // task type it actually flipped (skipping already-inactive ones) —
    // revokedTaskTypes is exactly that list, reported back by the store
    // since it has no event system of its own to emit these internally.
    for (const revokedTaskType of revokedTaskTypes) {
      this.emit({ type: "autonomy.revoked", tenantId, taskType: revokedTaskType, reason: "manual", at });
    }
  }

  /** Thin passthrough — exists so a caller (apps/api's approvals route)
   *  only needs one dependency (ApprovalQueue) instead of reaching past it
   *  into `.autonomy` directly, and so this is the one place that would
   *  ever emit autonomy.activated if that's added later. Previously,
   *  accepting an offer bypassed ApprovalQueue entirely (called straight
   *  against a SEPARATE PostgresDurableAutonomyStore instance) — which was
   *  exactly the split-brain this whole change closes; now it's the same
   *  store object submitProposedAction reads. */
  async acceptOffer(tenantId: string, taskType: string): Promise<void> {
    await this.autonomy.acceptOffer(tenantId, taskType);
  }
}
