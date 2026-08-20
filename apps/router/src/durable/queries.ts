import { withTenantScope, type PoolLike, type StoredAuditEvent } from "@byok/db";

/**
 * Read-side data contract for the Phase B cost/activity dashboard (issue
 * #6 item d) — nothing here writes anything. Every method is a plain
 * aggregate query over the durable-storage tables from
 * migrations/0002_durable_storage.sql.
 *
 * NAMING NOTE: the router's RouterTask has both `teamId` and `subAgentId`,
 * but the cost gate's reservation record only has `roleId`/`taskType` —
 * router.ts passes `roleId: task.teamId, taskType: task.subAgentId` when
 * calling into the gate (see submitTask()). So in cost_reservations,
 * `role_id` IS the router's teamId and `task_type` IS the router's
 * subAgentId. "Spend by sub-agent" and "spend by task type" are therefore
 * the SAME query (spendByTaskType) — there's no separate sub-agent column
 * to group by beyond that.
 */
export interface SpendByDimension {
  key: string;
  totalUsd: number;
}

export interface ActivityByDimension {
  key: string;
  taskCount: number;
  totalUsd: number;
}

export interface AutonomyStatus {
  taskType: string;
  active: boolean;
  consecutiveApprovals: number;
  /** Set once a task type crosses the offer threshold, cleared on any
   *  reset (rejection, spot-check revoke, manual revoke) — null means no
   *  pending offer. See autonomyEngine.ts's own state machine; this
   *  column mirrors it 1:1 in autonomy_counters. */
  offeredAt: string | null;
}

export interface CostActivityQueries {
  /** Spend grouped by role (cost_reservations.role_id — the router's teamId). */
  spendByRole(tenantId: string, since?: Date): Promise<SpendByDimension[]>;
  /** Spend grouped by task type (cost_reservations.task_type — the router's
   *  subAgentId) — this IS "spend by sub-agent", see the module note above. */
  spendByTaskType(tenantId: string, since?: Date): Promise<SpendByDimension[]>;
  /** Earned-autonomy status for every task type this tenant has any history for. */
  autonomyStatus(tenantId: string): Promise<AutonomyStatus[]>;
  /** Recent queue/gate activity — the unified audit_log, newest first. */
  recentActivity(tenantId: string, limit?: number): Promise<StoredAuditEvent[]>;
  /** Task count AND spend grouped by task type (= sub-agent, see the
   *  module note above) since a given time — the digest's "what each
   *  agent did" panel needs a count, not just a dollar total. */
  activityByTaskType(tenantId: string, since: Date): Promise<ActivityByDimension[]>;
  /** The real cost already reserved for each of the given ref ids (router
   *  task ids, i.e. approval_queue_items.id) — cost-gate's audit_log rows
   *  carry ref_id = the same task id an approval item is keyed by (see
   *  router.ts's evaluateAndReserve({taskId: task.id, ...}) and the
   *  approval item's own id: task.id). By the time a task reaches the
   *  approval queue its cost has already been reserved (and usually
   *  settled) — approving/rejecting doesn't change what it cost, so this
   *  is real incurred spend, not a forward-looking estimate. Ids with no
   *  matching row (e.g. a task submitted with no CostGate configured,
   *  local dev) are simply absent from the returned map, not zeroed. */
  costByRefIds(tenantId: string, refIds: readonly string[]): Promise<Record<string, number>>;
}

interface SpendRow {
  key: string;
  total_usd: string;
}

export class PostgresCostActivityQueries implements CostActivityQueries {
  constructor(private readonly pool: PoolLike) {}

  async spendByRole(tenantId: string, since?: Date): Promise<SpendByDimension[]> {
    return this.spendBy(tenantId, "role_id", since);
  }

  async spendByTaskType(tenantId: string, since?: Date): Promise<SpendByDimension[]> {
    return this.spendBy(tenantId, "task_type", since);
  }

  private async spendBy(tenantId: string, column: "role_id" | "task_type", since?: Date): Promise<SpendByDimension[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT ${column} AS key, COALESCE(SUM(amount_usd), 0) AS total_usd
         FROM cost_reservations
         WHERE tenant_id = $1::uuid AND status IN ('reserved', 'settled') AND created_at >= $2
         GROUP BY ${column}
         ORDER BY total_usd DESC`,
        [tenantId, since ?? new Date(0)],
      )) as unknown as { rows: SpendRow[] };
      return result.rows.map((r) => ({ key: r.key, totalUsd: Number(r.total_usd) }));
    });
  }

  async autonomyStatus(tenantId: string): Promise<AutonomyStatus[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT task_type, active, consecutive_approvals, offered_at FROM autonomy_counters WHERE tenant_id = $1::uuid ORDER BY task_type`,
        [tenantId],
      )) as unknown as { rows: Array<{ task_type: string; active: boolean; consecutive_approvals: number; offered_at: string | null }> };
      return result.rows.map((r) => ({
        taskType: r.task_type,
        active: r.active,
        consecutiveApprovals: r.consecutive_approvals,
        offeredAt: r.offered_at,
      }));
    });
  }

  async activityByTaskType(tenantId: string, since: Date): Promise<ActivityByDimension[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT task_type AS key, COUNT(*) AS task_count, COALESCE(SUM(amount_usd), 0) AS total_usd
         FROM cost_reservations
         WHERE tenant_id = $1::uuid AND status IN ('reserved', 'settled') AND created_at >= $2
         GROUP BY task_type
         ORDER BY total_usd DESC`,
        [tenantId, since],
      )) as unknown as { rows: Array<{ key: string; task_count: string; total_usd: string }> };
      return result.rows.map((r) => ({ key: r.key, taskCount: Number(r.task_count), totalUsd: Number(r.total_usd) }));
    });
  }

  async costByRefIds(tenantId: string, refIds: readonly string[]): Promise<Record<string, number>> {
    if (refIds.length === 0) return {};
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT ref_id, (detail->>'amountUsd')::numeric AS amount_usd
         FROM audit_log
         WHERE tenant_id = $1::uuid AND source = 'cost-gate' AND kind = 'reserved' AND ref_id = ANY($2::text[])`,
        [tenantId, refIds],
      )) as unknown as { rows: Array<{ ref_id: string; amount_usd: string }> };
      const out: Record<string, number> = {};
      for (const row of result.rows) out[row.ref_id] = Number(row.amount_usd);
      return out;
    });
  }

  async recentActivity(tenantId: string, limit = 50): Promise<StoredAuditEvent[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        // ORDER BY seq, not `at` — see durableAuditLog.ts's recentForTenant
        // for why (now() ties within one transaction).
        `SELECT id, tenant_id, source, kind, ref_id, detail, at FROM audit_log WHERE tenant_id = $1::uuid ORDER BY seq DESC LIMIT $2`,
        [tenantId, limit],
      )) as unknown as {
        rows: Array<{ id: string; tenant_id: string; source: "cost-gate" | "approval-queue"; kind: string; ref_id: string | null; detail: Record<string, unknown> | null; at: string }>;
      };
      return result.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        source: row.source,
        kind: row.kind,
        refId: row.ref_id ?? undefined,
        detail: row.detail ?? undefined,
        at: row.at,
      }));
    });
  }
}
