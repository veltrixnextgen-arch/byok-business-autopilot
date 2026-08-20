import type { ApprovalQueue } from "@byok/approval-queue";
import { isDeniedFromAutonomy } from "@byok/approval-queue";
import type { AutonomyStatus, CostActivityQueries } from "@byok/router";

export interface ApprovalItem {
  id: string;
  kind: "action" | "recommendation";
  agentName: string;
  roleTitle: string;
  /** null for recommendations — RecommendationItem has no taskType, and
   *  T10 recommendations never earn autonomy anyway (they never dispatch
   *  an effect, so ApprovalQueue.resolveRecommendation never calls
   *  recordApproval). */
  taskType: string | null;
  title: string;
  output: string;
  /** "If you approve" — real, structured text from the action's own
   *  EffectDescriptor, not invented. null when the action has no effect
   *  at all (a pure draft, or any recommendation) — approving those just
   *  marks the item reviewed, nothing dispatches. */
  effectDescription: string | null;
  stakesTags: string[];
  /** Computed with the exact same isDeniedFromAutonomy check the backend
   *  uses for real gating (denyList.ts) — never a guess. */
  neverEarnsAutonomy: boolean;
  /** Real, already-incurred spend (see costByRefIds's own doc comment) —
   *  null only when no matching cost-gate reservation exists at all
   *  (e.g. local dev with no CostGate configured), never a fabricated 0. */
  costUsd: number | null;
  createdAt: string;
}

export interface ApprovalsView {
  items: ApprovalItem[];
  autonomyStatus: AutonomyStatus[];
}

export interface ApprovalsViewDeps {
  approvalQueue: Pick<ApprovalQueue, "pendingActions" | "pendingRecommendationItems">;
  costActivity: Pick<CostActivityQueries, "costByRefIds" | "autonomyStatus">;
}

/** One-at-a-time queue, oldest first — the design spec's explicit choice
 *  (a scannable list is the wrong shape here), so ordering is decided
 *  once, here, not left to each caller. */
export async function buildApprovalsView(deps: ApprovalsViewDeps, tenantId: string): Promise<ApprovalsView> {
  const [actions, recommendations, autonomyStatus] = await Promise.all([
    deps.approvalQueue.pendingActions(tenantId),
    deps.approvalQueue.pendingRecommendationItems(tenantId),
    deps.costActivity.autonomyStatus(tenantId),
  ]);

  const costs = await deps.costActivity.costByRefIds(tenantId, [...actions.map((a) => a.id), ...recommendations.map((r) => r.id)]);

  const items: ApprovalItem[] = [
    ...actions.map(
      (a): ApprovalItem => ({
        id: a.id,
        kind: "action",
        agentName: a.agentName,
        roleTitle: a.roleTitle,
        taskType: a.taskType,
        title: a.summary,
        output: a.draft,
        effectDescription: a.effect?.description ?? null,
        stakesTags: a.stakesTags,
        neverEarnsAutonomy: isDeniedFromAutonomy(a.stakesTags),
        costUsd: costs[a.id] ?? null,
        createdAt: a.createdAt,
      }),
    ),
    ...recommendations.map(
      (r): ApprovalItem => ({
        id: r.id,
        kind: "recommendation",
        agentName: r.agentName,
        roleTitle: r.roleTitle,
        taskType: null,
        title: r.summary,
        output: r.draft,
        effectDescription: null,
        stakesTags: r.stakesTags,
        neverEarnsAutonomy: isDeniedFromAutonomy(r.stakesTags),
        costUsd: costs[r.id] ?? null,
        createdAt: r.createdAt,
      }),
    ),
  ].sort((x, y) => x.createdAt.localeCompare(y.createdAt));

  return { items, autonomyStatus };
}
