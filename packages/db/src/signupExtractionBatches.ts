import type { OrgChart } from "@byok/contracts";
import { withUserScope } from "./userContext.js";
import type { PoolLike } from "./tenantContext.js";

export type SignupExtractionBatchStatus = "running" | "completed" | "failed";

export interface SignupExtractionBatch {
  id: string;
  userId: string;
  idea: string;
  status: SignupExtractionBatchStatus;
  orgChart: OrgChart | null;
  costUsd: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SignupExtractionBatchRow {
  id: string;
  user_id: string;
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
         RETURNING id, user_id, idea, status, org_chart, cost_usd, error, created_at, updated_at`,
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
        `SELECT id, user_id, idea, status, org_chart, cost_usd, error, created_at, updated_at
         FROM signup_extraction_batches WHERE id = $1::uuid AND user_id = $2::uuid`,
        [id, userId],
      )) as unknown as { rows: SignupExtractionBatchRow[] };
      return result.rows[0] ? rowToBatch(result.rows[0]) : null;
    });
  }

  /** For resuming after a tab close: the most recent batch for this user,
   *  regardless of status, so a client that lost its in-memory batch id
   *  can still pick up a running or just-completed extraction. */
  async latestForUser(userId: string): Promise<SignupExtractionBatch | null> {
    return withUserScope(this.pool, userId, async (client) => {
      const result = (await client.query(
        `SELECT id, user_id, idea, status, org_chart, cost_usd, error, created_at, updated_at
         FROM signup_extraction_batches WHERE user_id = $1::uuid
         ORDER BY created_at DESC LIMIT 1`,
        [userId],
      )) as unknown as { rows: SignupExtractionBatchRow[] };
      return result.rows[0] ? rowToBatch(result.rows[0]) : null;
    });
  }
}
