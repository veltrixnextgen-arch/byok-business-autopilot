import { InvalidTenantIdError, timedConnect, UNSET_SCOPE_UUID } from "./tenantContext.js";
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
 *
 * Also explicitly clears app.tenant_id and app.internal_metrics — see
 * UNSET_SCOPE_UUID's comment (tenantContext.ts) for why this scope
 * function can't just trust those to already be unset on a reused
 * pooled connection. This is exactly the bug issue #38 caught: a prior
 * claim (withUserAndTenantScope) leaving app.tenant_id set on a
 * connection this function later reused, letting a since-claimed row
 * stay visible to its original user's session.
 */
export async function withUserScope<T>(
  pool: PoolLike,
  userId: string,
  fn: (client: PoolClientLike) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(userId)) {
    throw new InvalidUserIdError(userId);
  }

  const client = await timedConnect(pool);
  let releaseErr: unknown;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [UNSET_SCOPE_UUID]);
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

/**
 * Both app.user_id AND app.tenant_id set for the lifetime of one
 * transaction — needed only for the one-time transfer operation that
 * moves a row from being visible under the user-scoped RLS branch to the
 * tenant-scoped one (see migrations/0006_signup_extraction_batch_tenant_transfer.sql
 * and claimLatestForTenant in signupExtractionBatches.ts, issue #38). The
 * transfer's SELECT (finding the source row) needs app.user_id; its
 * UPDATE's WITH CHECK (accepting the row's new, now-tenant-owned state)
 * needs app.tenant_id — both true at once, in one atomic transaction, or
 * the two RLS branches in owner_isolation can't both be satisfied by a
 * single statement.
 */
export async function withUserAndTenantScope<T>(
  pool: PoolLike,
  userId: string,
  tenantId: string,
  fn: (client: PoolClientLike) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(userId)) {
    throw new InvalidUserIdError(userId);
  }
  if (!UUID_PATTERN.test(tenantId)) {
    throw new InvalidTenantIdError(tenantId);
  }

  const client = await timedConnect(pool);
  let releaseErr: unknown;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
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
