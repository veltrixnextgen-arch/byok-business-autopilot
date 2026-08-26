import type { OrgChart } from "@byok/contracts";
import { withInternalMetricsScope } from "./signupMetrics.js";
import { withUserAndTenantScope, withUserScope } from "./userContext.js";
import { withTenantScope, type PoolLike } from "./tenantContext.js";

export type SignupExtractionBatchStatus = "running" | "completed" | "failed";

export interface SignupExtractionBatch {
  id: string;
  userId: string;
  /** Set once claimed by a tenant (issue #38) — null until then. See
   *  migrations/0006_signup_extraction_batch_tenant_transfer.sql. */
  tenantId: string | null;
  idea: string;
  status: SignupExtractionBatchStatus;
  orgChart: OrgChart | null;
  costUsd: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const SELECT_COLUMNS =
  "id, user_id, tenant_id, idea, status, org_chart, cost_usd, error, created_at, updated_at";

interface SignupExtractionBatchRow {
  id: string;
  user_id: string;
  tenant_id: string | null;
  idea: string;
  status: SignupExtractionBatchStatus;
  org_chart: OrgChart | null;
  cost_usd: string | null; // numeric columns come back as strings from pg
  error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToBatch(row: SignupExtractionBatchRow): SignupExtractionBatch {
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    idea: row.idea,
    status: row.status,
    orgChart: row.org_chart,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The extraction batch's own persistence — deliberately separate from the
 * cost gate's reservation ledger (packages/cost-gate), which tracks
 * spend/ceilings, not the batch's product output (the org chart) or its
 * resumability state. Keyed to user_id, not tenant_id — see
 * migrations/0004_signup_extraction_batches.sql and ADR-015 for why: this
 * runs before any tenant exists.
 */
export class SignupExtractionBatchStore {
  constructor(private readonly pool: PoolLike) {}

  async start(userId: string, idea: string): Promise<SignupExtractionBatch> {
    return withUserScope(this.pool, userId, async (client) => {
      const result = (await client.query(
        `INSERT INTO signup_extraction_batches (user_id, idea, status)
         VALUES ($1::uuid, $2, 'running')
         RETURNING ${SELECT_COLUMNS}`,
        [userId, idea],
      )) as unknown as { rows: SignupExtractionBatchRow[] };
      return rowToBatch(result.rows[0]);
    });
  }

  async complete(userId: string, id: string, orgChart: OrgChart, costUsd: number): Promise<void> {
    await withUserScope(this.pool, userId, async (client) => {
      await client.query(
        `UPDATE signup_extraction_batches
         SET status = 'completed', org_chart = $3::jsonb, cost_usd = $4, updated_at = now()
         WHERE id = $1::uuid AND user_id = $2::uuid`,
        [id, userId, JSON.stringify(orgChart), costUsd],
      );
    });
  }

  /** Persists a re-clustered org chart after an edit op (task list
   *  check/uncheck/add, agent rename/merge/split) — no cost change, since
   *  re-clustering runs the real assembleOrgChart function locally
   *  (packages/agents/extraction), not a new LLM batch. Only valid on an
   *  already-completed batch; leaves status/costUsd untouched. */
  async updateOrgChart(userId: string, id: string, orgChart: OrgChart): Promise<void> {
    await withUserScope(this.pool, userId, async (client) => {
      await client.query(
        `UPDATE signup_extraction_batches
         SET org_chart = $3::jsonb, updated_at = now()
         WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'completed'`,
        [id, userId, JSON.stringify(orgChart)],
      );
    });
  }

  async fail(userId: string, id: string, error: string): Promise<void> {
    await withUserScope(this.pool, userId, async (client) => {
      await client.query(
        `UPDATE signup_extraction_batches
         SET status = 'failed', error = $3, updated_at = now()
         WHERE id = $1::uuid AND user_id = $2::uuid`,
        [id, userId, error],
      );
    });
  }

  async get(userId: string, id: string): Promise<SignupExtractionBatch | null> {
    return withUserScope(this.pool, userId, async (client) => {
      const result = (await client.query(
        `SELECT ${SELECT_COLUMNS}
         FROM signup_extraction_batches WHERE id = $1::uuid AND user_id = $2::uuid`,
        [id, userId],
      )) as unknown as { rows: SignupExtractionBatchRow[] };
      return result.rows[0] ? rowToBatch(result.rows[0]) : null;
    });
  }

  /** Tenant-scoped equivalent of `get`, valid only after a chart has been
   *  claimed (issue #38) — reads via app.tenant_id, never app.user_id. */
  async getForTenant(tenantId: string, id: string): Promise<SignupExtractionBatch | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT ${SELECT_COLUMNS}
         FROM signup_extraction_batches WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        [id, tenantId],
      )) as unknown as { rows: SignupExtractionBatchRow[] };
      return result.rows[0] ? rowToBatch(result.rows[0]) : null;
    });
  }

  /** Tenant-scoped equivalent of `updateOrgChart` (issue #141) — needed
   *  because a claimed batch is no longer reachable via app.user_id at
   *  all once tenant_id is set (0006's own RLS policy closes that path
   *  deliberately, see that migration's comment); `updateOrgChart`
   *  would silently touch zero rows against an already-claimed batch.
   *  Whole-org-chart read-modify-write, same as the user-scoped version —
   *  callers (e.g. cadence editing) read the current chart, mutate the
   *  one field they care about, and write the whole thing back. */
  async updateOrgChartForTenant(tenantId: string, id: string, orgChart: OrgChart): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `UPDATE signup_extraction_batches
         SET org_chart = $3::jsonb, updated_at = now()
         WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        [id, tenantId, JSON.stringify(orgChart)],
      );
    });
  }

  /** The tenant's claimed org chart, if any (issue #38) — the
   *  post-transfer read path DashboardScreen/OrgChartScreen use once an
   *  organization exists. The tenant_id unique index means there's at
   *  most one row to find, but this mirrors latestForUser's shape
   *  (ORDER BY + LIMIT 1) rather than assuming that invariant here too. */
  async latestForTenant(tenantId: string): Promise<SignupExtractionBatch | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT ${SELECT_COLUMNS}
         FROM signup_extraction_batches WHERE tenant_id = $1::uuid
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId],
      )) as unknown as { rows: SignupExtractionBatchRow[] };
      return result.rows[0] ? rowToBatch(result.rows[0]) : null;
    });
  }

  /**
   * The transfer itself (issue #38, ADR-015's deferred gap). Idempotent:
   * if this tenant has already claimed a batch, returns it unchanged
   * rather than attempting another claim — safe to call more than once
   * (a retried request, a double-click on "create company"). Otherwise
   * claims the user's most recent COMPLETED, not-yet-claimed batch —
   * older completed batches from earlier interview attempts, and any
   * batch already claimed by a different tenant, are never touched, so a
   * user with multiple pre-org extractions can't end up with orphaned or
   * cross-claimed records. Returns null when there is nothing eligible to
   * claim (e.g. the user never completed an interview) — a no-op, not an
   * error.
   */
  async claimLatestForTenant(userId: string, tenantId: string): Promise<SignupExtractionBatch | null> {
    return withUserAndTenantScope(this.pool, userId, tenantId, async (client) => {
      const alreadyClaimed = (await client.query(
        `SELECT ${SELECT_COLUMNS} FROM signup_extraction_batches WHERE tenant_id = $1::uuid LIMIT 1`,
        [tenantId],
      )) as unknown as { rows: SignupExtractionBatchRow[] };
      if (alreadyClaimed.rows[0]) return rowToBatch(alreadyClaimed.rows[0]);

      const claimed = (await client.query(
        `UPDATE signup_extraction_batches
         SET tenant_id = $2::uuid, updated_at = now()
         WHERE id = (
           SELECT id FROM signup_extraction_batches
           WHERE user_id = $1::uuid AND tenant_id IS NULL AND status = 'completed'
           ORDER BY created_at DESC
           LIMIT 1
         )
         RETURNING ${SELECT_COLUMNS}`,
        [userId, tenantId],
      )) as unknown as { rows: SignupExtractionBatchRow[] };
      if (claimed.rows[0]) return rowToBatch(claimed.rows[0]);

      // Nothing claimed — either there was genuinely nothing eligible, or
      // a concurrent call for this same tenant won the race between the
      // idempotency check above and this UPDATE's subquery evaluation.
      // Re-check before reporting "nothing to claim" so a losing racer
      // still reports the winner's result instead of a false null.
      const recheck = (await client.query(
        `SELECT ${SELECT_COLUMNS} FROM signup_extraction_batches WHERE tenant_id = $1::uuid LIMIT 1`,
        [tenantId],
      )) as unknown as { rows: SignupExtractionBatchRow[] };
      return recheck.rows[0] ? rowToBatch(recheck.rows[0]) : null;
    });
  }

  /** For the internal metrics route (Phase B Step 6C) only — every user's
   *  most recent batch, via the same internal_metrics RLS exception
   *  0005_signup_metrics.sql adds to this table's policy. Not exposed
   *  through any endpoint a tester's own session can reach. */
  async allLatestBatchSummaries(): Promise<Pick<SignupExtractionBatch, "userId" | "status" | "costUsd" | "createdAt">[]> {
    return withInternalMetricsScope(this.pool, async (client) => {
      const result = (await client.query(
        `SELECT DISTINCT ON (user_id) user_id, status, cost_usd, created_at
         FROM signup_extraction_batches ORDER BY user_id, created_at DESC`,
      )) as unknown as { rows: Pick<SignupExtractionBatchRow, "user_id" | "status" | "cost_usd" | "created_at">[] };
      return result.rows.map((r) => ({
        userId: r.user_id,
        status: r.status,
        costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
        createdAt: r.created_at,
      }));
    });
  }

  /** For resuming after a tab close: the most recent batch for this user,
   *  regardless of status, so a client that lost its in-memory batch id
   *  can still pick up a running or just-completed extraction. */
  async latestForUser(userId: string): Promise<SignupExtractionBatch | null> {
    return withUserScope(this.pool, userId, async (client) => {
      const result = (await client.query(
        `SELECT ${SELECT_COLUMNS}
         FROM signup_extraction_batches WHERE user_id = $1::uuid
         ORDER BY created_at DESC LIMIT 1`,
        [userId],
      )) as unknown as { rows: SignupExtractionBatchRow[] };
      return result.rows[0] ? rowToBatch(result.rows[0]) : null;
    });
  }
}
