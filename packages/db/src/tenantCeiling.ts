import { withTenantScope, type PoolLike } from "./tenantContext.js";

/**
 * The durable half of issue #15's safety net — the tenant's own override of
 * CostGate's companyMonthlyUsd ceiling (see @byok/cost-gate's
 * CeilingConfigResolver). Deliberately its own tiny module, not folded into
 * signupExtractionBatches.ts or schema.ts: this concern belongs to
 * tenants (post-org), not the pre-org signup flow, and doesn't need a full
 * store class for two queries.
 *
 * Uses withTenantScope for its UUID validation and transaction handling,
 * not for RLS: the `tenants` table itself carries no tenant_id column and
 * has no row-level-security policy (it's the root entity every tenant_id
 * elsewhere points AT), so the isolation guarantee here is entirely the
 * caller's — tenantId must always come from the server-verified session
 * (tenantMiddleware), never a request body/param, same discipline every
 * other tenant-scoped route already follows.
 */
export class TenantCeilingStore {
  constructor(private readonly pool: PoolLike) {}

  /** Null means "no override set" — the caller falls back to the platform
   *  default, never to $0. */
  async get(tenantId: string): Promise<number | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(`SELECT monthly_ceiling_usd FROM tenants WHERE id = $1::uuid`, [
        tenantId,
      ])) as unknown as { rows: Array<{ monthly_ceiling_usd: string | null }> };
      const value = result.rows[0]?.monthly_ceiling_usd;
      return value === null || value === undefined ? null : Number(value);
    });
  }

  async set(tenantId: string, companyMonthlyUsd: number): Promise<void> {
    if (!Number.isFinite(companyMonthlyUsd) || companyMonthlyUsd <= 0) {
      throw new InvalidCeilingError(companyMonthlyUsd);
    }
    await withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(`UPDATE tenants SET monthly_ceiling_usd = $2 WHERE id = $1::uuid`, [
        tenantId,
        companyMonthlyUsd,
      ]);
    });
  }
}

export class InvalidCeilingError extends Error {
  constructor(value: number) {
    super(`Invalid monthly ceiling: ${value}. Must be a finite number greater than 0.`);
    this.name = "InvalidCeilingError";
  }
}
