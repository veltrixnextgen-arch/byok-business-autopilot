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

/**
 * Same withTenantScope-for-its-UUID-handling reasoning as getTenantTier
 * above. The DB's own CHECK constraint (migration 0010) is the actual
 * backstop against an invalid value reaching the column; TenantTier's
 * three-literal union is what keeps an invalid value from being
 * constructed in the first place at every call site.
 *
 * Deliberately does NOT re-sync the BullMQ schedule itself — that needs
 * the tenant's active Charter + claimed org chart, neither of which this
 * package (packages/db) has any business reaching into apps/api's
 * scheduler wiring for. The caller (apps/api's tier route) re-syncs
 * after calling this, reusing the exact computeDesiredSchedule +
 * syncTenantSchedule pair Charter acceptance already triggers — see
 * scheduler.ts's own comment, which already anticipated this call site
 * ("a caller only needs this route directly for a manual re-sync, e.g.
 * after a tier change moves the cadence floor").
 */
export async function setTenantTier(pool: PoolLike, tenantId: string, tier: TenantTier): Promise<void> {
  await withTenantScope(pool, tenantId, async (client) => {
    await client.query(`UPDATE tenants SET tier = $2 WHERE id = $1::uuid`, [tenantId, tier]);
  });
}

export interface TenantStripeIds {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

/**
 * Issue #18/ADR-045 (migration 0015). Stored for operational/support use
 * (looking up a tenant's real Stripe customer record) and a future
 * "manage billing" portal-link — NOT used to resolve which tenant a
 * webhook event is about (every event this app handles carries tenantId
 * in its own metadata already, see billing/stripeClient.ts). Called
 * alongside applyTierChange, never in place of it — this only persists
 * the Stripe-side identifiers, `tier` is a separate write.
 */
export async function setTenantStripeIds(pool: PoolLike, tenantId: string, ids: TenantStripeIds): Promise<void> {
  await withTenantScope(pool, tenantId, async (client) => {
    await client.query(`UPDATE tenants SET stripe_customer_id = $2, stripe_subscription_id = $3 WHERE id = $1::uuid`, [
      tenantId,
      ids.stripeCustomerId,
      ids.stripeSubscriptionId,
    ]);
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
