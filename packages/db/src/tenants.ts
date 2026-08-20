import type { PoolLike } from "./tenantContext.js";

// The one deliberate cross-tenant read in this codebase outside the
// internal-metrics carve-out (signupMetrics.ts's withInternalMetricsScope)
// — but `tenants` itself was never RLS-scoped to begin with (0001_init.sql
// only enables RLS on tenant_members), so no policy carve-out is needed,
// unlike that other case. Used to seed the daily digest batch job's loop;
// every per-tenant read after this (charter, org chart, cost totals) still
// goes through its own properly tenant-scoped store method.
export async function listAllTenantIds(pool: PoolLike): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = (await client.query("SELECT id FROM tenants ORDER BY created_at")) as unknown as { rows: Array<{ id: string }> };
    return result.rows.map((r) => r.id);
  } finally {
    client.release();
  }
}
