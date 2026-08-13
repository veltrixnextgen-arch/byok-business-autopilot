import { Pool } from "pg";
import { withTenantScope } from "./tenantContext.js";
import { withUserScope } from "./userContext.js";

/**
 * One-off (but reusable) cleanup for throwaway `*@example.invalid` test
 * accounts created against a real deployed environment — e.g. via manual
 * QA or the chrome-devtools performance measurement pass this was written
 * for. Deliberately email-driven (not id-driven): whoever runs this knows
 * the email they signed up with, not the generated uuid.
 *
 * Deletes, per email, in FK/RLS-safe order:
 *   1. signup_funnel_events / signup_feedback / signup_extraction_batches
 *      (app.user_id-scoped tables — withUserScope)
 *   2. tenant_members for every org the user belongs to (app.tenant_id-
 *      scoped — withTenantScope, one call per org since the policy is
 *      keyed to a single tenant per transaction)
 *   3. tenants + users (packages/db's own mirror tables — no RLS)
 *   4. organization + "user" (Better Auth's own tables — no RLS; deleting
 *      these cascades member/invitation/session/account automatically)
 *
 * Never run this against a real user's email by accident — there is no
 * confirmation prompt. Not exported from index.ts; run directly via tsx.
 */
async function deleteAccountByEmail(pool: Pool, email: string): Promise<void> {
  const userRow = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])) as {
    rows: Array<{ id: string }>;
  };
  const userId = userRow.rows[0]?.id;
  if (!userId) {
    console.log(`[delete-test-accounts] ${email}: no such user — nothing to delete`);
    return;
  }

  const memberRows = (await pool.query("SELECT organization_id FROM member WHERE user_id = $1", [userId])) as {
    rows: Array<{ organization_id: string }>;
  };
  const orgIds = memberRows.rows.map((r) => r.organization_id);

  await withUserScope(pool, userId, async (client) => {
    await client.query("DELETE FROM signup_funnel_events WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM signup_feedback WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM signup_extraction_batches WHERE user_id = $1", [userId]);
  });

  for (const orgId of orgIds) {
    await withTenantScope(pool, orgId, async (client) => {
      await client.query("DELETE FROM tenant_members WHERE tenant_id = $1", [orgId]);
    });
  }

  if (orgIds.length > 0) {
    await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [orgIds]);
    await pool.query("DELETE FROM organization WHERE id = ANY($1::uuid[])", [orgIds]);
  }
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);

  console.log(`[delete-test-accounts] ${email}: deleted user ${userId} and ${orgIds.length} organization(s)`);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required (never printed by this script).");
  }
  const emails = process.argv.slice(2);
  if (emails.length === 0) {
    throw new Error("Usage: tsx src/deleteTestAccounts.ts <email> [email...]");
  }

  const pool = new Pool({ connectionString });
  try {
    for (const email of emails) {
      await deleteAccountByEmail(pool, email);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "delete-test-accounts failed with a non-Error throw.");
  process.exitCode = 1;
});
