import { withTenantScope, type PoolLike } from "./tenantContext.js";

/**
 * The tenant's owner(s)/admin(s) email addresses — who a schedule
 * pause/resume notification (issue #140) goes to. Plain members are
 * deliberately excluded: this is a billing-adjacent alert (the ceiling
 * that triggered it is an owner/admin-level setting), the same
 * owner/admin distinction ceiling.ts's own step-up-auth note anticipates
 * for who should be able to act on it.
 */
export async function getTenantOwnerEmails(pool: PoolLike, tenantId: string): Promise<string[]> {
  return withTenantScope(pool, tenantId, async (client) => {
    const result = (await client.query(
      `SELECT u.email FROM tenant_members tm JOIN users u ON u.id = tm.user_id
       WHERE tm.tenant_id = $1::uuid AND tm.role IN ('owner', 'admin')`,
      [tenantId],
    )) as unknown as { rows: Array<{ email: string }> };
    return result.rows.map((r) => r.email);
  });
}
