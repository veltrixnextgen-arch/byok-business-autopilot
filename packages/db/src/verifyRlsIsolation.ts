import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withTenantScope } from "./tenantContext.js";

/**
 * A real negative test against a live database, run as part of the STEP 2
 * staging deploy: connects as the app's own restricted role (never a
 * superuser), inserts a row under tenant A, then proves tenant B's session
 * cannot read it back — not because a query errors, but because
 * FORCE ROW LEVEL SECURITY makes the row simply not exist from tenant B's
 * point of view. "Migrations ran" proves the schema loaded; this proves the
 * isolation the schema claims to enforce is actually enforced by Postgres
 * itself for the exact role the deployed app connects as.
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required (the app_user connection string — never printed by this script).");
  }

  const pool = new Pool({ connectionString });

  // Diagnostic only — role attributes, never the credential itself. If this
  // ever shows rolsuper/rolbypassrls = true, everything below is moot: a
  // role with BYPASSRLS skips FORCE ROW LEVEL SECURITY entirely regardless
  // of policy correctness. Neon's Console/API-created roles inherit
  // neon_superuser membership (-> BYPASSRLS) unless created via plain SQL.
  const roleCheck = (await pool.query(
    "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
  )) as { rows: Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }> };
  const role = roleCheck.rows[0];
  if (role) {
    console.log(`[rls-verify] connected as role "${role.rolname}" — rolsuper=${role.rolsuper} rolbypassrls=${role.rolbypassrls}`);
    if (role.rolsuper || role.rolbypassrls) {
      console.log(
        "[rls-verify] this role bypasses RLS at the Postgres level — FORCE ROW LEVEL SECURITY has no effect on it, " +
          "regardless of policy correctness. It must not be used as the app's runtime role.",
      );
    }
  }

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const userId = randomUUID();
  const runId = randomUUID().slice(0, 8);
  let memberRowId: string | undefined;

  try {
    await pool.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3), ($4, $5, $6)", [
      tenantAId,
      `rls-verify-a-${runId}`,
      "RLS verify tenant A",
      tenantBId,
      `rls-verify-b-${runId}`,
      "RLS verify tenant B",
    ]);
    await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, `rls-verify-${runId}@example.invalid`]);
    console.log(`[rls-verify] seeded tenant A, tenant B, and one user (run ${runId})`);

    memberRowId = randomUUID();
    await withTenantScope(pool, tenantAId, async (client) => {
      await client.query("INSERT INTO tenant_members (id, tenant_id, user_id, role) VALUES ($1, $2, $3, 'owner')", [
        memberRowId,
        tenantAId,
        userId,
      ]);
    });
    console.log(`[rls-verify] inserted tenant_members row ${memberRowId} under tenant A`);

    const ownRead = await withTenantScope(pool, tenantAId, async (client) => {
      return client.query("SELECT id FROM tenant_members WHERE id = $1", [memberRowId]) as Promise<{ rows: unknown[] }>;
    });
    if (ownRead.rows.length !== 1) {
      throw new Error(`FAIL: tenant A could not read its own row back (expected 1 row, got ${ownRead.rows.length}) — test setup is broken, not proof of isolation.`);
    }
    console.log("[rls-verify] PASS: tenant A reads its own row (1 row) — proves the row genuinely exists");

    const crossTenantRead = await withTenantScope(pool, tenantBId, async (client) => {
      return client.query("SELECT id FROM tenant_members WHERE id = $1", [memberRowId]) as Promise<{ rows: unknown[] }>;
    });
    if (crossTenantRead.rows.length !== 0) {
      throw new Error(`FAIL: tenant B read ${crossTenantRead.rows.length} row(s) belonging to tenant A. RLS isolation is NOT enforced on this database.`);
    }
    console.log("[rls-verify] PASS: tenant B's cross-tenant read of tenant A's row returned ZERO rows — refused, not errored");

    const noContextClient = await pool.connect();
    let noContextRows: unknown[];
    try {
      const res = (await noContextClient.query("SELECT id FROM tenant_members WHERE id = $1", [memberRowId])) as { rows: unknown[] };
      noContextRows = res.rows;
    } finally {
      noContextClient.release();
    }
    if (noContextRows.length !== 0) {
      throw new Error(`FAIL: a connection with no tenant context set read ${noContextRows.length} row(s). RLS isolation is NOT enforced on this database.`);
    }
    console.log("[rls-verify] PASS: no tenant context set also returns ZERO rows");

    console.log("RLS ISOLATION: VERIFIED — app_user cannot cross tenant boundaries on tenant_members");
  } finally {
    try {
      if (memberRowId) {
        await withTenantScope(pool, tenantAId, async (client) => {
          await client.query("DELETE FROM tenant_members WHERE id = $1", [memberRowId]);
        });
      }
      await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[tenantAId, tenantBId]]);
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      console.log(`[rls-verify] cleanup complete (run ${runId})`);
    } finally {
      await pool.end();
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "RLS verification failed with a non-Error throw.");
  process.exitCode = 1;
});
