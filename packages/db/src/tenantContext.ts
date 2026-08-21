import { logSlowConnectionWait } from "./connection.js";

// Structural interfaces (not `import type { Pool, PoolClient } from "pg"`) so
// this module — and its tests — don't require a live pg connection to type-check
// or exercise; `pg.Pool`/`pg.PoolClient` satisfy these shapes structurally.
export interface PoolClientLike {
  query(text: string, values?: unknown[]): Promise<unknown>;
  // `release(err)` — a real pg.PoolClient discards the underlying
  // connection instead of returning it to the pool when passed a truthy
  // error. Every scope function below relies on this: if COMMIT/ROLLBACK
  // itself fails (e.g. the connection is already unstable), releasing
  // "clean" would hand a connection that's still mid-transaction to
  // whichever unrelated caller does the next pool.connect() — which is
  // exactly the shape of bug that leaves a session idling inside an open
  // transaction until Neon's idle_in_transaction_session_timeout kills it,
  // taking down the whole process on the resulting uncaught error event.
  release(err?: unknown): void;
}

export interface PoolLike {
  connect(): Promise<PoolClientLike>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A custom (non-built-in) GUC's `set_config(name, value, true)` — the
// SET LOCAL equivalent every scope function here uses — does not reliably
// revert to a true NULL once the setting transaction commits, on a
// pooled connection that's handed to a later, unrelated call: empirically
// it can be observed to STICK at its last value instead (a documented
// quirk of placeholder/custom GUCs, not standard-parameter behavior).
// Relying on "whichever app.* var this function doesn't set will read as
// unset" is therefore unsafe under connection pooling — issue #38 caught
// this for real: a claim's app.tenant_id leaked into a LATER, unrelated
// withUserScope call reusing the same physical connection, letting a
// user_id-only query see a row it should never see again post-transfer.
// Every scope function below now explicitly resets every app.* var it
// does NOT own to this sentinel — syntactically valid (never throws on
// cast to uuid) but never equal to a real, gen_random_uuid()-generated
// tenant/user id, so it can never accidentally satisfy an RLS policy.
export const UNSET_SCOPE_UUID = "00000000-0000-0000-0000-000000000000";

export class InvalidTenantIdError extends Error {
  constructor(tenantId: string) {
    super(`Invalid tenant id: "${tenantId}" is not a UUID.`);
    this.name = "InvalidTenantIdError";
  }
}

/** ADR-030: times `pool.connect()` and logs loudly if it took a while --
 *  the shared instrumentation point every scope function below (and
 *  userContext.ts's/signupMetrics.ts's siblings) uses. Deliberately NOT
 *  done by wrapping `pg.Pool`'s own `connect()` method: `pg-pool`'s own
 *  `query()` calls `this.connect(callback)` internally in callback
 *  style, and an override that only implements the promise form silently
 *  breaks that -- found live when it hung every `pool.query()` call in
 *  the app, not just the explicit `pool.connect()` sites this was meant
 *  to time. Timing each call site directly, as this does, never touches
 *  `pg-pool`'s own internals. */
export async function timedConnect(pool: PoolLike): Promise<PoolClientLike> {
  const startedAt = Date.now();
  try {
    return await pool.connect();
  } finally {
    logSlowConnectionWait(Date.now() - startedAt);
  }
}

/**
 * Runs `fn` inside a transaction with Postgres session setting
 * `app.tenant_id` bound to `tenantId` for the lifetime of that transaction.
 * Every RLS-policied table (see migrations/0001_init.sql) filters on this
 * setting, so any query `fn` issues is scoped to `tenantId` by the database
 * itself — a query for another tenant's rows returns nothing, it doesn't
 * throw and it doesn't leak, because the WHERE clause the policy injects
 * simply never matches.
 *
 * The tenant id is passed as a bound parameter to `set_config`, never
 * string-interpolated into SQL, so a malicious or malformed tenant id
 * cannot inject SQL here even before the format check below runs.
 *
 * Also explicitly clears app.user_id and app.internal_metrics — see
 * UNSET_SCOPE_UUID's comment above for why this scope function can't
 * just trust those to already be unset on a reused pooled connection.
 */
export async function withTenantScope<T>(
  pool: PoolLike,
  tenantId: string,
  fn: (client: PoolClientLike) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new InvalidTenantIdError(tenantId);
  }

  const client = await timedConnect(pool);
  let releaseErr: unknown;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [UNSET_SCOPE_UUID]);
    await client.query("SELECT set_config('app.internal_metrics', 'false', true)");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    releaseErr = err;
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection is likely already broken — release(releaseErr) below
      // discards it either way, so there's nothing more to do here.
    }
    throw err;
  } finally {
    client.release(releaseErr);
  }
}
