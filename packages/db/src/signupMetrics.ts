import { withUserScope } from "./userContext.js";
import { UNSET_SCOPE_UUID, type PoolClientLike, type PoolLike } from "./tenantContext.js";

export type FunnelScreen = "signup" | "interview" | "tasks" | "org_chart";

export interface FunnelEventRow {
  userId: string;
  screen: FunnelScreen;
  at: string;
}

export interface FeedbackRow {
  userId: string;
  taughtSomething: boolean;
  freeText: string | null;
  at: string;
}

/**
 * Mirrors withUserScope/withTenantScope's own pattern exactly, but sets
 * app.internal_metrics instead of app.user_id — the one narrow exception
 * carved into 0005_signup_metrics.sql's RLS policies to let the token-gated
 * internal metrics route (apps/api/src/routes/internalMetrics.ts) read
 * across every user's rows. Never used for writes — see migrate.test.ts's
 * assertion that this flag never appears in a WITH CHECK clause.
 *
 * Also explicitly clears app.user_id and app.tenant_id — see
 * UNSET_SCOPE_UUID's comment (tenantContext.ts) for why a scope function
 * can't just trust another app.* var to already be unset on a reused
 * pooled connection. This function's own queries don't read those two,
 * but leaving them stale here would be exactly the class of leak issue
 * #38 found — closing it symmetrically on every scope function, not just
 * the ones that happened to get caught by a test.
 */
export async function withInternalMetricsScope<T>(pool: PoolLike, fn: (client: PoolClientLike) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.internal_metrics', 'true', true)");
    await client.query("SELECT set_config('app.user_id', $1, true)", [UNSET_SCOPE_UUID]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [UNSET_SCOPE_UUID]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The MVP-0 tester-gate store (Phase B Step 6C): four funnel checkpoints
 * per signup (signup/interview/tasks/org_chart — "idea input" isn't
 * tracked separately since it's required to reach signup at all, so it's
 * implicitly 100%) plus one optional feedback answer. Deliberately this
 * thin — no event properties, no session replay, no analytics vendor.
 */
export class SignupMetricsStore {
  constructor(private readonly pool: PoolLike) {}

  async recordFunnelEvent(userId: string, screen: FunnelScreen): Promise<void> {
    await withUserScope(this.pool, userId, async (client) => {
      await client.query(`INSERT INTO signup_funnel_events (user_id, screen) VALUES ($1::uuid, $2)`, [userId, screen]);
    });
  }

  async recordFeedback(userId: string, taughtSomething: boolean, freeText: string | null): Promise<void> {
    await withUserScope(this.pool, userId, async (client) => {
      await client.query(
        `INSERT INTO signup_feedback (user_id, taught_something, free_text)
         VALUES ($1::uuid, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET taught_something = $2, free_text = $3, at = now()`,
        [userId, taughtSomething, freeText],
      );
    });
  }

  /** Every funnel event across every user, oldest first — the internal
   *  metrics route derives per-signup completion/drop-off/time-to-org-chart
   *  from this in memory rather than a wider SQL aggregation, since a
   *  20-tester pilot's whole event table is a handful of rows. */
  async allFunnelEvents(): Promise<FunnelEventRow[]> {
    return withInternalMetricsScope(this.pool, async (client) => {
      const result = (await client.query(`SELECT user_id, screen, at FROM signup_funnel_events ORDER BY at ASC`)) as unknown as {
        rows: { user_id: string; screen: FunnelScreen; at: string }[];
      };
      return result.rows.map((r) => ({ userId: r.user_id, screen: r.screen, at: r.at }));
    });
  }

  async allFeedback(): Promise<FeedbackRow[]> {
    return withInternalMetricsScope(this.pool, async (client) => {
      const result = (await client.query(`SELECT user_id, taught_something, free_text, at FROM signup_feedback`)) as unknown as {
        rows: { user_id: string; taught_something: boolean; free_text: string | null; at: string }[];
      };
      return result.rows.map((r) => ({ userId: r.user_id, taughtSomething: r.taught_something, freeText: r.free_text, at: r.at }));
    });
  }
}
