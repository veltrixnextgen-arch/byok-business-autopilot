import type { ActivityByDimension, CostActivityQueries } from "@byok/router";
import type { ApprovalQueue } from "@byok/approval-queue";
import type { CompanyCharterStore, SignupExtractionBatchStore, TenantCeilingStore } from "@byok/db";
import type { DurableReservationStore } from "@byok/cost-gate";
import { DEFAULT_MONTHLY_CEILING_USD } from "../routes/ceiling.js";

export interface DigestDeps {
  charters: Pick<CompanyCharterStore, "getActive">;
  batchStore: Pick<SignupExtractionBatchStore, "latestForTenant">;
  costActivity: Pick<CostActivityQueries, "activityByTaskType">;
  approvalQueue: Pick<ApprovalQueue, "pendingActions" | "pendingRecommendationItems">;
  ceilings: Pick<TenantCeilingStore, "get">;
  reservationTotals: Pick<DurableReservationStore, "totals">;
}

export interface DigestAgentActivity {
  agentId: string;
  agentName: string;
  taskCount: number;
  spentUsd: number;
}

export interface DigestData {
  tenantId: string;
  date: string; // yyyy-mm-dd, UTC
  agentActivity: DigestAgentActivity[];
  pendingApprovalCount: number;
  spentUsd: number;
  ceilingUsd: number;
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Single source of truth for "what's in today's digest" — called by both
 * the scheduled email job (sendDailyDigests.ts) and GET /me/digest, so
 * the in-app screen and the email can never drift into showing different
 * numbers for the same day. Every field here is a real read from an
 * existing store; nothing is invented. Returns null when the tenant has
 * no active Charter+org chart yet — there's nothing honest to report,
 * same as dashboard.ts's own "no active Charter" handling elsewhere.
 *
 * Agent names are resolved by joining cost_reservations.task_type back to
 * the org chart's agent.id — they're the same value for any task that
 * originated from the org chart (see apps/router's queries.ts module
 * note: task_type IS the router's subAgentId, and scheduledDispatchProcessor
 * sets subAgentId: agent.id). A task_type with no matching agent falls
 * back to the raw id rather than silently dropping the row.
 */
export async function buildDigestData(deps: DigestDeps, tenantId: string): Promise<DigestData | null> {
  const [charter, batch] = await Promise.all([deps.charters.getActive(tenantId), deps.batchStore.latestForTenant(tenantId)]);
  if (!charter?.cascade || !batch?.orgChart) return null;

  const since = startOfTodayUtc();
  const [activity, pendingActions, pendingRecommendations, ceilingOverride, totals] = await Promise.all([
    deps.costActivity.activityByTaskType(tenantId, since),
    deps.approvalQueue.pendingActions(tenantId),
    deps.approvalQueue.pendingRecommendationItems(tenantId),
    deps.ceilings.get(tenantId),
    deps.reservationTotals.totals(tenantId, "company", "company"),
  ]);

  const agentById = new Map(batch.orgChart.agents.map((a) => [a.id, a]));
  const agentActivity: DigestAgentActivity[] = activity
    .map((row: ActivityByDimension) => ({
      agentId: row.key,
      agentName: agentById.get(row.key)?.name ?? row.key,
      taskCount: row.taskCount,
      spentUsd: row.totalUsd,
    }))
    .sort((a, b) => b.spentUsd - a.spentUsd);

  return {
    tenantId,
    date: since.toISOString().slice(0, 10),
    agentActivity,
    pendingApprovalCount: pendingActions.length + pendingRecommendations.length,
    spentUsd: totals.totalUsd,
    ceilingUsd: ceilingOverride ?? DEFAULT_MONTHLY_CEILING_USD,
  };
}
