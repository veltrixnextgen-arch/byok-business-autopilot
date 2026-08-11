import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { withTenantScope } from "./tenantContext.js";
import { withUserAndTenantScope, withUserScope } from "./userContext.js";

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
async function verifyTenantIsolation(pool: Pool, connectionString: string, runId: string): Promise<void> {
  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const userId = randomUUID();
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

    // A dedicated one-off Client, not a pool.connect() — pool connections
    // get reused across the checks above, and Postgres resets a
    // set_config(..., true)-scoped custom GUC to an empty string at
    // transaction end, not back to "undefined". current_setting(...) would
    // then see '' instead of NULL, and ''::uuid throws — a real
    // fail-closed outcome (an error, not a leak), but not the clean
    // "truly never set" case this check means to prove. A fresh physical
    // connection that has never run set_config guarantees the real case.
    const noContextClient = new Client({ connectionString });
    await noContextClient.connect();
    let noContextRows: unknown[];
    try {
      const res = (await noContextClient.query("SELECT id FROM tenant_members WHERE id = $1", [memberRowId])) as { rows: unknown[] };
      noContextRows = res.rows;
    } finally {
      await noContextClient.end();
    }
    if (noContextRows.length !== 0) {
      throw new Error(`FAIL: a connection with no tenant context set read ${noContextRows.length} row(s). RLS isolation is NOT enforced on this database.`);
    }
    console.log("[rls-verify] PASS: no tenant context set also returns ZERO rows");

    console.log("RLS ISOLATION (tenant_members): VERIFIED — app_user cannot cross tenant boundaries");
  } finally {
    try {
      if (memberRowId) {
        await withTenantScope(pool, tenantAId, async (client) => {
          await client.query("DELETE FROM tenant_members WHERE id = $1", [memberRowId]);
        });
      }
      await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[tenantAId, tenantBId]]);
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      console.log(`[rls-verify] tenant cleanup complete (run ${runId})`);
    } catch {
      // best-effort cleanup — a failure here must not mask the real
      // pass/fail result of the checks above.
    }
  }
}

/**
 * Same proof as verifyTenantIsolation, for signup_extraction_batches
 * (migrations/0004_signup_extraction_batches.sql, ADR-015) — this table
 * is scoped by app.user_id, not app.tenant_id, since it's written before
 * any tenant exists. "The RLS policy compiles" doesn't prove it's
 * enforced for the exact role the deployed app connects as; only a real
 * cross-user read attempt does.
 */
async function verifyUserIsolation(pool: Pool, connectionString: string, runId: string): Promise<void> {
  const userAId = randomUUID();
  const userBId = randomUUID();
  let batchId: string | undefined;

  try {
    await pool.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [
      userAId,
      `rls-verify-user-a-${runId}@example.invalid`,
      userBId,
      `rls-verify-user-b-${runId}@example.invalid`,
    ]);
    console.log(`[rls-verify] seeded user A and user B (run ${runId})`);

    batchId = randomUUID();
    await withUserScope(pool, userAId, async (client) => {
      await client.query("INSERT INTO signup_extraction_batches (id, user_id, idea, status) VALUES ($1, $2, $3, 'running')", [
        batchId,
        userAId,
        "rls-verify idea",
      ]);
    });
    console.log(`[rls-verify] inserted signup_extraction_batches row ${batchId} under user A`);

    const ownRead = await withUserScope(pool, userAId, async (client) => {
      return client.query("SELECT id FROM signup_extraction_batches WHERE id = $1", [batchId]) as Promise<{ rows: unknown[] }>;
    });
    if (ownRead.rows.length !== 1) {
      throw new Error(`FAIL: user A could not read its own row back (expected 1 row, got ${ownRead.rows.length}) — test setup is broken, not proof of isolation.`);
    }
    console.log("[rls-verify] PASS: user A reads its own row (1 row) — proves the row genuinely exists");

    const crossUserRead = await withUserScope(pool, userBId, async (client) => {
      return client.query("SELECT id FROM signup_extraction_batches WHERE id = $1", [batchId]) as Promise<{ rows: unknown[] }>;
    });
    if (crossUserRead.rows.length !== 0) {
      throw new Error(`FAIL: user B read ${crossUserRead.rows.length} row(s) belonging to user A. RLS isolation is NOT enforced on this table.`);
    }
    console.log("[rls-verify] PASS: user B's cross-user read of user A's row returned ZERO rows — refused, not errored");

    const noContextClient = new Client({ connectionString });
    await noContextClient.connect();
    let noContextRows: unknown[];
    try {
      const res = (await noContextClient.query("SELECT id FROM signup_extraction_batches WHERE id = $1", [batchId])) as { rows: unknown[] };
      noContextRows = res.rows;
    } finally {
      await noContextClient.end();
    }
    if (noContextRows.length !== 0) {
      throw new Error(`FAIL: a connection with no user context set read ${noContextRows.length} row(s). RLS isolation is NOT enforced on this table.`);
    }
    console.log("[rls-verify] PASS: no user context set also returns ZERO rows");

    console.log("RLS ISOLATION (signup_extraction_batches): VERIFIED — app_user cannot cross user boundaries");
  } finally {
    try {
      if (batchId) {
        await withUserScope(pool, userAId, async (client) => {
          await client.query("DELETE FROM signup_extraction_batches WHERE id = $1", [batchId]);
        });
      }
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userAId, userBId]]);
      console.log(`[rls-verify] user cleanup complete (run ${runId})`);
    } catch {
      // best-effort cleanup, same reasoning as verifyTenantIsolation's.
    }
  }
}

/**
 * Same proof again, for the issue #38 transfer boundary specifically:
 * once a signup_extraction_batches row is claimed by a tenant
 * (migrations/0006_signup_extraction_batch_tenant_transfer.sql), it must
 * be readable by that tenant's own session and by NO ONE else — not the
 * original user's session, not a different tenant's. "The policy
 * compiles" doesn't prove either half of that; only a real claim followed
 * by real cross-boundary read attempts does.
 */
async function verifyTransferIsolation(pool: Pool, runId: string): Promise<void> {
  const userId = randomUUID();
  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  let batchId: string | undefined;

  try {
    await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, `rls-verify-transfer-${runId}@example.invalid`]);
    await pool.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3), ($4, $5, $6)", [
      tenantAId,
      `rls-verify-transfer-a-${runId}`,
      "RLS verify transfer tenant A",
      tenantBId,
      `rls-verify-transfer-b-${runId}`,
      "RLS verify transfer tenant B",
    ]);
    console.log(`[rls-verify] seeded one user and two tenants for the transfer check (run ${runId})`);

    batchId = randomUUID();
    await withUserScope(pool, userId, async (client) => {
      await client.query(
        "INSERT INTO signup_extraction_batches (id, user_id, idea, status) VALUES ($1, $2, $3, 'completed')",
        [batchId, userId, "rls-verify transfer idea"],
      );
    });
    console.log(`[rls-verify] inserted signup_extraction_batches row ${batchId} under the user, unclaimed`);

    await withUserAndTenantScope(pool, userId, tenantAId, async (client) => {
      await client.query("UPDATE signup_extraction_batches SET tenant_id = $1::uuid WHERE id = $2::uuid", [tenantAId, batchId]);
    });
    console.log(`[rls-verify] claimed the row for tenant A`);

    const ownTenantRead = await withTenantScope(pool, tenantAId, async (client) => {
      return client.query("SELECT id FROM signup_extraction_batches WHERE id = $1", [batchId]) as Promise<{ rows: unknown[] }>;
    });
    if (ownTenantRead.rows.length !== 1) {
      throw new Error(`FAIL: tenant A could not read its own claimed row back (expected 1 row, got ${ownTenantRead.rows.length}).`);
    }
    console.log("[rls-verify] PASS: tenant A reads its own claimed row (1 row)");

    const originalUserRead = await withUserScope(pool, userId, async (client) => {
      return client.query("SELECT id FROM signup_extraction_batches WHERE id = $1", [batchId]) as Promise<{ rows: unknown[] }>;
    });
    if (originalUserRead.rows.length !== 0) {
      throw new Error(
        `FAIL: the original user could still read ${originalUserRead.rows.length} row(s) after transfer. The user_id path must close on claim.`,
      );
    }
    console.log("[rls-verify] PASS: the original user's own session can no longer read the claimed row — ZERO rows");

    const otherTenantRead = await withTenantScope(pool, tenantBId, async (client) => {
      return client.query("SELECT id FROM signup_extraction_batches WHERE id = $1", [batchId]) as Promise<{ rows: unknown[] }>;
    });
    if (otherTenantRead.rows.length !== 0) {
      throw new Error(`FAIL: tenant B read ${otherTenantRead.rows.length} row(s) belonging to tenant A's claimed chart.`);
    }
    console.log("[rls-verify] PASS: tenant B's cross-tenant read of tenant A's claimed row returned ZERO rows");

    console.log("RLS ISOLATION (signup_extraction_batches, post-transfer): VERIFIED");
  } finally {
    try {
      if (batchId) {
        await withTenantScope(pool, tenantAId, async (client) => {
          await client.query("DELETE FROM signup_extraction_batches WHERE id = $1", [batchId]);
        });
      }
      await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[tenantAId, tenantBId]]);
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      console.log(`[rls-verify] transfer-check cleanup complete (run ${runId})`);
    } catch {
      // best-effort cleanup — a failure here must not mask the real
      // pass/fail result of the checks above.
    }
  }
}

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

  const runId = randomUUID().slice(0, 8);

  try {
    await verifyTenantIsolation(pool, connectionString, runId);
    await verifyUserIsolation(pool, connectionString, runId);
    await verifyTransferIsolation(pool, runId);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "RLS verification failed with a non-Error throw.");
  process.exitCode = 1;
});
