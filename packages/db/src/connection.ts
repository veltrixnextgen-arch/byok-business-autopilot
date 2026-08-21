import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

// ADR-030: the same class of bug ADR-027 already found and fixed for the
// Redis/BullMQ connection ("a connection that can hang forever with no
// bound") -- found here for Postgres after a live incident where a
// pool.connect() call with no connectionTimeoutMillis meant a caller
// waiting for a saturated pool waited forever, with no error, no log,
// nothing to observe except every downstream query also hanging (the
// exact same silent-hang shape as the pre-ADR-027 Redis bug). All three
// bounds below close a version of that same gap:
//   - connectionTimeoutMillis: how long to wait for a free pool slot (or
//     a new connection to establish) before giving up loudly.
//   - statement_timeout: how long any single query may run server-side --
//     a genuinely stuck query (not just a saturated pool) fails loud too.
//   - idle_in_transaction_session_timeout: how long a transaction may sit
//     open with no activity. A withTenantScope transaction that never
//     reaches COMMIT/ROLLBACK (e.g. the process was killed mid-transaction
//     by a redeploy) can hold a row lock that blocks every later writer
//     to that same row -- bounding this at our end means Postgres itself
//     reclaims that lock after this many ms, rather than depending on
//     whatever the hosting provider's own default happens to be.
// 10s/30s/30s, not a smaller "fail fast" value: every real query this
// pool runs is a lightweight per-request OLTP read/write (withTenantScope
// transactions are BEGIN, a couple SET commands, one query, COMMIT), so
// these bounds exist to catch genuinely stuck cases, not to shave
// latency off the normal path.
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;

// Anything waited longer than this for a pool slot is worth knowing about
// even if it eventually succeeds (well under connectionTimeoutMillis) --
// pool saturation creeping up is a signal worth seeing before it escalates
// into an actual timeout, and this exact failure mode was invisible until
// a human noticed a hanging page. Separate from connectionTimeoutMillis on
// purpose: that one is "give up," this one is "still worth a look."
const CONNECTION_WAIT_WARN_THRESHOLD_MS = 2_000;

export interface DbConnectionOptions {
  connectionString: string;
  max?: number;
  /** See this module's own top-of-file comment (ADR-030) for why each of
   *  these three has a default rather than being left to `pg`'s own
   *  (mostly unbounded) defaults. Overridable per-caller for the rare
   *  legitimately-slower workload; every real caller today uses the
   *  defaults. */
  connectionTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  idleInTransactionSessionTimeoutMillis?: number;
}

/** Exported for connection.test.ts -- a pure predicate, not a real timer
 *  or real pool.connect() call, is what lets this be tested without a
 *  live Postgres. */
export function logSlowConnectionWait(waitedMs: number, max: number, warnThresholdMs = CONNECTION_WAIT_WARN_THRESHOLD_MS): void {
  if (waitedMs > warnThresholdMs) {
    console.warn(`[pg.Pool] waited ${waitedMs}ms for a free connection (pool saturated? max=${max})`);
  }
}

export function createPool(options: DbConnectionOptions): Pool {
  const max = options.max ?? 10;
  const pool = new Pool({
    connectionString: options.connectionString,
    max,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    statement_timeout: options.statementTimeoutMillis ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: options.idleInTransactionSessionTimeoutMillis ?? DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });

  // pg.Pool emits 'error' when a client that's sitting IDLE in the pool
  // (already released, not mid-query) hits a connection-level problem --
  // the remote server terminating it, a network drop, an idle timeout.
  // This is separate from and complementary to PR #131's release(err) fix:
  // that fix stops OUR code from returning a connection to the pool in a
  // bad state; this handles the pool discovering on its own, later, that
  // an already-idle connection has gone bad. Node's default behavior for
  // an unhandled EventEmitter 'error' event is to throw and crash the
  // whole process -- which is exactly the mechanism behind this session's
  // "idle-in-transaction timeout" crashes taking down every tenant's API
  // for one poisoned connection. pg.Pool already removes the errored
  // client from its internal pool when this fires; listening here only
  // stops that from being fatal to the process, it isn't itself the
  // recovery mechanism.
  pool.on("error", (err) => {
    console.error("[pg.Pool] idle client error (connection discarded, pool continues):", err.message);
  });

  // ADR-030: surfaces pool saturation itself, not just the eventual
  // timeout -- see logSlowConnectionWait's own comment. Wrapping the
  // concrete instance's connect() here (rather than instrumenting every
  // withTenantScope/withUserScope call site) means every caller against
  // the real pool gets this for free, while test fakes (PoolLike, used
  // throughout this codebase's unit tests) are untouched.
  // Every real call site in this codebase uses the promise form (no
  // callback) -- only that overload is instrumented; reassigning as
  // `typeof pool.connect` keeps the callback overload's type available
  // to any future caller even though this wrapper doesn't implement it.
  const originalConnect: () => Promise<import("pg").PoolClient> = pool.connect.bind(pool);
  pool.connect = (async () => {
    const startedAt = Date.now();
    try {
      return await originalConnect();
    } finally {
      logSlowConnectionWait(Date.now() - startedAt, max);
    }
  }) as typeof pool.connect;

  return pool;
}

export type Database = NodePgDatabase<typeof schema>;

export function createDb(pool: Pool): Database {
  return drizzle(pool, { schema });
}
