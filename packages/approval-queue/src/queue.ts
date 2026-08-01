import { AutonomyEngine, type AutonomyEvent } from "./autonomyEngine.js";
import type { EffectExecutor, EffectResult } from "./effectExecutor.js";
import { InMemoryQueueAuditLog, type QueueAuditEvent, type QueueAuditLog } from "./auditLog.js";
import {
  EffectOnRecommendationError,
  UnknownActionError,
  UnknownRecommendationError,
  type ProposedAction,
  type RecommendationItem,
  type Verdict,
} from "./types.js";

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
  private readonly pending = new Map<string, ProposedAction>();
  private readonly pendingRecommendations = new Map<string, RecommendationItem>();
  private readonly spotCheckActionIds = new Set<string>();
  private readonly listeners: QueueEventListener[] = [];

  constructor(
    public readonly autonomy: AutonomyEngine,
    private readonly effectExecutor: EffectExecutor,
    private readonly audit: QueueAuditLog = new InMemoryQueueAuditLog(),
  ) {
    // Forward autonomy events through the same single subscription surface
    // — callers don't need to know the autonomy engine exists separately.
    this.autonomy.onEvent((event) => this.emit(event));
  }

  onEvent(listener: QueueEventListener): void {
    this.listeners.push(listener);
  }

  private emit(event: QueueEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async submitProposedAction(action: ProposedAction): Promise<SubmitResult> {
    const autonomyActive = this.autonomy.isActive(action.tenantId, action.taskType) && !this.autonomy.isDeniable(action.stakesTags);

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

    if (autonomyActive) {
      // Autonomy is active but the sampler picked this one for review.
      this.spotCheckActionIds.add(action.id);
    }

    this.pending.set(action.id, action);
    const at = new Date().toISOString();
    this.audit.append({ at, actionId: action.id, tenantId: action.tenantId, taskType: action.taskType, kind: "queued" });
    this.emit({ type: "action.queued", actionId: action.id, tenantId: action.tenantId, taskType: action.taskType, at });
    return { queued: true };
  }

  async resolve(actionId: string, verdict: Verdict): Promise<ResolveResult> {
    const action = this.pending.get(actionId);
    if (!action) throw new UnknownActionError(`No pending action "${actionId}".`);
    this.pending.delete(actionId);
    const isSpotCheck = this.spotCheckActionIds.delete(actionId);

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
        this.autonomy.recordSpotCheckRejection(action.tenantId, action.taskType);
      } else {
        this.autonomy.recordRejection(action.tenantId, action.taskType);
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
    this.autonomy.recordApproval(action.tenantId, action.taskType, action.stakesTags);

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

  submitRecommendation(item: RecommendationItem): void {
    // Defense in depth: the type has no `effect` field, but nothing stops
    // a caller from smuggling one in via `as any`. Reject it at runtime too.
    if ("effect" in (item as unknown as Record<string, unknown>)) {
      throw new EffectOnRecommendationError(
        "A RecommendationItem can never carry an effect descriptor (T10) — the CEO's only output pathway is guidance.",
      );
    }
    this.pendingRecommendations.set(item.id, item);
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
  resolveRecommendation(id: string, verdict: Verdict): void {
    const item = this.pendingRecommendations.get(id);
    if (!item) throw new UnknownRecommendationError(`No pending recommendation "${id}".`);
    this.pendingRecommendations.delete(id);

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

  pendingActions(): readonly ProposedAction[] {
    return [...this.pending.values()];
  }

  pendingRecommendationItems(): readonly RecommendationItem[] {
    return [...this.pendingRecommendations.values()];
  }

  auditEvents(): readonly QueueAuditEvent[] {
    return this.audit.all();
  }

  revokeAutonomy(tenantId: string, taskType?: string): void {
    this.autonomy.revoke(tenantId, taskType);
  }
}
