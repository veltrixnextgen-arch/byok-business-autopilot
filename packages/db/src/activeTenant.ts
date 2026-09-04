import { timedConnect, withTenantScope, type PoolLike } from "./tenantContext.js";

export class TenantNotMemberError extends Error {
  constructor(userId: string, tenantId: string) {
    super(`User ${userId} is not a member of tenant ${tenantId} — cannot make it their active company.`);
    this.name = "TenantNotMemberError";
  }
}

/**
 * One row per user: which single tenant/company is currently active for
 * them (scheduled, dispatching, spending). Every other tenant they
 * belong to via tenant_members stays inactive -- visible, listed, never
 * dispatched against. See migrations/0023_user_active_tenant.sql for
 * the table + backfill; isTenantActive is what a follow-up PR wires
 * into CostGate/the scheduler to actually enforce this.
 */
export class ActiveTenantStore {
  constructor(private readonly pool: PoolLike) {}

  async getActiveTenantId(userId: string): Promise<string | null> {
    const client = await timedConnect(this.pool);
    try {
      const result = (await client.query(`SELECT tenant_id FROM user_active_tenant WHERE user_id = $1::uuid`, [
        userId,
      ])) as unknown as { rows: Array<{ tenant_id: string }> };
      return result.rows[0]?.tenant_id ?? null;
    } finally {
      client.release();
    }
  }

  /**
   * Switches the user's active company to `tenantId`. Throws
   * TenantNotMemberError if the user doesn't belong to that tenant --
   * this store never lets a user activate a company they aren't a
   * member of, regardless of what a caller passes in.
   *
   * The membership check runs inside a tenant-scoped transaction
   * (app.tenant_id set to `tenantId`) so it's actually subject to
   * tenant_members' own RLS policy, rather than silently reading zero
   * rows regardless of the truth (tenant_members IS row-level-secured,
   * unlike user_active_tenant itself -- see the migration's comment for
   * why those two tables get different treatment).
   */
  async setActiveTenant(userId: string, tenantId: string): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      const membership = (await client.query(
        `SELECT 1 FROM tenant_members WHERE user_id = $1::uuid AND tenant_id = $2::uuid`,
        [userId, tenantId],
      )) as unknown as { rows: unknown[] };
      if (membership.rows.length === 0) {
        throw new TenantNotMemberError(userId, tenantId);
      }
      await client.query(
        `INSERT INTO user_active_tenant (user_id, tenant_id, activated_at)
         VALUES ($1::uuid, $2::uuid, now())
         ON CONFLICT (user_id) DO UPDATE SET tenant_id = $2::uuid, activated_at = now()`,
        [userId, tenantId],
      );
    });
  }

  /**
   * Is `tenantId` currently ANY user's active company? Read-only.
   * user_active_tenant carries no RLS (see the migration's comment), so
   * this needs no particular transaction scope -- CostGate/the
   * scheduler call it directly, from whatever scope they're already in.
   */
  async isTenantActive(tenantId: string): Promise<boolean> {
    const client = await timedConnect(this.pool);
    try {
      const result = (await client.query(`SELECT 1 FROM user_active_tenant WHERE tenant_id = $1::uuid LIMIT 1`, [
        tenantId,
      ])) as unknown as { rows: unknown[] };
      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }
}
