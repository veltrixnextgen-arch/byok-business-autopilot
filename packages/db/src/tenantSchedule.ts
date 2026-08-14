import { withTenantScope, type PoolLike } from "./tenantContext.js";

// R3 (ADR-025): the real, shipped subscription tiers
// (apps/web/src/lib/pricingConstants.ts's PRICING_TIERS) — not the plan
// doc's "Founder/Operator/Agency" naming, which doesn't exist anywhere in
// this codebase's actual pricing surface. See migrations/0010's header and
// ADR-025 for the full reconciliation.
export type TenantTier = "solo" | "company" | "scale";

/**
 * Tier is read the same way monthly_ceiling_usd is (TenantCeilingStore):
 * withTenantScope for its UUID validation and transaction handling, not
 * because `tenants` itself is row-level-secured (it isn't — 0001_init.sql's
 * own comment explains why: it's the root entity every tenant_id elsewhere
 * points at). Defaults to 'solo' at the column level (migration 0010) —
 * this function never needs its own fallback.
 */
export async function getTenantTier(pool: PoolLike, tenantId: string): Promise<TenantTier> {
  return withTenantScope(pool, tenantId, async (client) => {
    const result = (await client.query(`SELECT tier FROM tenants WHERE id = $1::uuid`, [tenantId])) as unknown as {
      rows: Array<{ tier: TenantTier }>;
    };
    return result.rows[0]?.tier ?? "solo";
  });
}

export interface TenantScheduleState {
  tenantId: string;
  pausedAt: string | null;
  pausedReason: string | null;
  pausedBatchId: string | null;
}

interface TenantScheduleStateRow {
  tenant_id: string;
  paused_at: string | null;
  paused_reason: string | null;
  paused_batch_id: string | null;
}

function rowToState(row: TenantScheduleStateRow): TenantScheduleState {
  return {
    tenantId: row.tenant_id,
    pausedAt: row.paused_at,
    pausedReason: row.paused_reason,
    pausedBatchId: row.paused_batch_id,
  };
}

/**
 * Whether the scheduler has paused further scheduled dispatch for a tenant
 * (plan §6: "ceiling hit at 3am -> all further dispatch pauses"). A tenant
 * with no row here has never been paused — `get` returns the "not paused"
 * state rather than null, so callers never have to special-case "no row
 * yet" separately from "row exists, not paused".
 */
export class TenantScheduleStateStore {
  constructor(private readonly pool: PoolLike) {}

  async get(tenantId: string): Promise<TenantScheduleState> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT tenant_id, paused_at, paused_reason, paused_batch_id FROM tenant_schedule_state WHERE tenant_id = $1::uuid`,
        [tenantId],
      )) as unknown as { rows: TenantScheduleStateRow[] };
      return result.rows[0] ? rowToState(result.rows[0]) : { tenantId, pausedAt: null, pausedReason: null, pausedBatchId: null };
    });
  }

  /** Pauses further scheduled dispatch — the scheduled-dispatch worker
   *  checks this before every job it processes (fail-closed: unreadable
   *  state is treated as paused, never as "assume unpaused"). `pausedBatchId`
   *  points at the resumable record in `paused_batches`
   *  (packages/cost-gate's existing exhaustion mechanism) a resume replays
   *  from. */
  async pause(tenantId: string, reason: string, pausedBatchId: string | null): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenant_schedule_state (tenant_id, paused_at, paused_reason, paused_batch_id, updated_at)
         VALUES ($1::uuid, now(), $2, $3::uuid, now())
         ON CONFLICT (tenant_id) DO UPDATE
           SET paused_at = now(), paused_reason = $2, paused_batch_id = $3::uuid, updated_at = now()`,
        [tenantId, reason, pausedBatchId],
      );
    });
  }

  async resume(tenantId: string): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenant_schedule_state (tenant_id, paused_at, paused_reason, paused_batch_id, updated_at)
         VALUES ($1::uuid, NULL, NULL, NULL, now())
         ON CONFLICT (tenant_id) DO UPDATE
           SET paused_at = NULL, paused_reason = NULL, paused_batch_id = NULL, updated_at = now()`,
        [tenantId],
      );
    });
  }
}
