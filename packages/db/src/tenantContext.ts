// Structural interfaces (not `import type { Pool, PoolClient } from "pg"`) so
// this module — and its tests — don't require a live pg connection to type-check
// or exercise; `pg.Pool`/`pg.PoolClient` satisfy these shapes structurally.
export interface PoolClientLike {
  query(text: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}

export interface PoolLike {
  connect(): Promise<PoolClientLike>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidTenantIdError extends Error {
  constructor(tenantId: string) {
    super(`Invalid tenant id: "${tenantId}" is not a UUID.`);
    this.name = "InvalidTenantIdError";
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
 */
export async function withTenantScope<T>(
  pool: PoolLike,
  tenantId: string,
  fn: (client: PoolClientLike) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new InvalidTenantIdError(tenantId);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
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
