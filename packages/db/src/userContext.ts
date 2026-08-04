import type { PoolClientLike, PoolLike } from "./tenantContext.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidUserIdError extends Error {
  constructor(userId: string) {
    super(`Invalid user id: "${userId}" is not a UUID.`);
    this.name = "InvalidUserIdError";
  }
}

/**
 * Mirrors withTenantScope (tenantContext.ts) exactly, keyed on
 * app.user_id instead of app.tenant_id — for tables that aren't
 * tenant-scoped because no tenant exists yet (ADR-015: the pre-org
 * extraction batch, signup_extraction_batches). Same reasoning applies:
 * a query for another user's rows returns nothing, not an error, because
 * the RLS policy's WHERE clause never matches.
 */
export async function withUserScope<T>(
  pool: PoolLike,
  userId: string,
  fn: (client: PoolClientLike) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(userId)) {
    throw new InvalidUserIdError(userId);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
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
