import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export interface DbConnectionOptions {
  connectionString: string;
  max?: number;
}

export function createPool(options: DbConnectionOptions): Pool {
  const pool = new Pool({ connectionString: options.connectionString, max: options.max ?? 10 });

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

  return pool;
}

export type Database = NodePgDatabase<typeof schema>;

export function createDb(pool: Pool): Database {
  return drizzle(pool, { schema });
}
