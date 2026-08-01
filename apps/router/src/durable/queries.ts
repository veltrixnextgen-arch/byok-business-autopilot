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

export interface AutonomyStatus {
  taskType: string;
  active: boolean;
  consecutiveApprovals: number;
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
        `SELECT task_type, active, consecutive_approvals FROM autonomy_counters WHERE tenant_id = $1::uuid ORDER BY task_type`,
        [tenantId],
      )) as unknown as { rows: Array<{ task_type: string; active: boolean; consecutive_approvals: number }> };
      return result.rows.map((r) => ({ taskType: r.task_type, active: r.active, consecutiveApprovals: r.consecutive_approvals }));
    });
  }

  async recentActivity(tenantId: string, limit = 50): Promise<StoredAuditEvent[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT id, tenant_id, source, kind, ref_id, detail, at FROM audit_log WHERE tenant_id = $1::uuid ORDER BY at DESC LIMIT $2`,
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
