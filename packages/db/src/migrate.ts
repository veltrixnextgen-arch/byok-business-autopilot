import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface QueryablePool {
  query(text: string): Promise<unknown>;
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

// Applied in order; append new files here as they're added, never reorder
// or edit an already-applied one — write a new migration instead.
const MIGRATION_FILES = [
  "0001_init.sql",
  "0002_durable_storage.sql",
  "0003_better_auth.sql",
  "0004_signup_extraction_batches.sql",
  "0005_signup_metrics.sql",
  "0006_signup_extraction_batch_tenant_transfer.sql",
  "0007_tenant_ceiling.sql",
  "0008_company_charters.sql",
  "0009_router_task_prompt_tier.sql",
  "0010_tenant_tier_and_scheduler.sql",
  "0011_vault_durable_storage.sql",
  "0012_audit_log_vault_source.sql",
  "0013_disable_rls_on_unprotected_tables.sql",
  "0014_revoke_supabase_api_roles.sql",
  "0015_tenant_billing.sql",
  "0016_template_task_deltas.sql",
  "0017_task_chains.sql",
  "0018_webhook_endpoints.sql",
];

// Arbitrary but fixed — the only requirement is stability across every
// caller. Postgres advisory locks are session-scoped and released
// automatically if the holding connection drops (crash, restart), so a
// killed migration run can never leave this stuck. Only replicas > 1
// makes this reachable today (single replica in every environment as of
// ADR-022), but it's cheap enough to hold unconditionally rather than
// special-case "this only matters once we scale."
const MIGRATION_LOCK_KEY = 847002931;

/**
 * Runs every migration, in order, against `pool` — now called on every
 * boot (ADR-022), not a manual one-time step. Every statement in every
 * migration file is written idempotent (CREATE TABLE IF NOT EXISTS, DROP
 * POLICY IF EXISTS + CREATE POLICY, ADD COLUMN IF NOT EXISTS) specifically
 * so this is safe to re-run against an already-current database — see
 * each migration file's own header comment.
 *
 * Wrapped in a Postgres advisory lock so two replicas booting at the same
 * moment serialize rather than race the same DDL — most of this file's
 * statements tolerate a race fine (IF NOT EXISTS is race-safe in
 * Postgres), but DROP POLICY IF EXISTS followed by CREATE POLICY is not:
 * two replicas interleaving those two statements could leave a real,
 * if narrow, window where a tenant-isolation policy is dropped but not
 * yet recreated. The lock closes that window entirely rather than relying
 * on it being unlikely.
 */
export async function runMigrations(pool: QueryablePool): Promise<void> {
  await pool.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
  try {
    for (const file of MIGRATION_FILES) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await pool.query(sql);
    }
  } finally {
    await pool.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
  }
}

export function migrationFiles(): readonly string[] {
  return MIGRATION_FILES;
}

export function migrationsDir(): string {
  return MIGRATIONS_DIR;
}

export interface SchemaCanary {
  table: string;
  column: string;
  /** Migration filename that adds this column — surfaced in the thrown
   *  error so whoever sees it knows exactly what to run, not just that
   *  something's wrong. */
  addedBy: string;
}

// One entry per migration that adds a column via ALTER TABLE ... ADD
// COLUMN, not per migration overall. Reasoning: a CREATE TABLE IF NOT
// EXISTS migration against a database that's never seen it either
// creates the whole table or is a total no-op — there's no way for the
// app to end up half-missing a table without an obvious crash on first
// use. An ALTER TABLE ADD COLUMN against a table that already exists is
// exactly the opposite: silent by construction if skipped. That silence
// — not a missing table — is what actually broke staging (Aug 8-12,
// two migrations shipped in eleven merged PRs while nothing ran them
// there; see ADR-022). Update this list whenever a new migration adds a
// column this way — verifySchemaCurrent only knows to check what's
// listed here.
const SCHEMA_CANARIES: readonly SchemaCanary[] = [
  { table: "signup_extraction_batches", column: "tenant_id", addedBy: "0006_signup_extraction_batch_tenant_transfer.sql" },
  { table: "tenants", column: "monthly_ceiling_usd", addedBy: "0007_tenant_ceiling.sql" },
  { table: "router_tasks", column: "prompt_tier", addedBy: "0009_router_task_prompt_tier.sql" },
  { table: "tenants", column: "tier", addedBy: "0010_tenant_tier_and_scheduler.sql" },
];

export class SchemaDriftError extends Error {}

/**
 * Independent of runMigrations — deliberately not called from inside it,
 * and deliberately not skipped just because runMigrations already ran
 * successfully this boot. The whole point (ADR-022's option (b)) is to
 * catch schema drift even if some future change removes the
 * runMigrations() call from a boot path but leaves this one — matching
 * ADR-007/008's pattern of refusing to start in a state the code can't
 * safely run in, rather than serving requests that will fail midway
 * through with a raw Postgres error a real user sees as a plain 500.
 */
export async function verifySchemaCurrent(pool: QueryablePool): Promise<void> {
  const tables = [...new Set(SCHEMA_CANARIES.map((c) => c.table))];
  const columnsByTable = new Map<string, Set<string>>();
  for (const table of tables) {
    const result = (await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'`,
    )) as { rows: { column_name: string }[] };
    columnsByTable.set(table, new Set(result.rows.map((r) => r.column_name)));
  }

  const missing = SCHEMA_CANARIES.filter((c) => !columnsByTable.get(c.table)?.has(c.column));
  if (missing.length > 0) {
    const detail = missing.map((c) => `${c.table}.${c.column} (added by ${c.addedBy})`).join(", ");
    throw new SchemaDriftError(
      `Database schema is behind what this code expects — missing: ${detail}. Run migrations (runMigrations / npm run db:migrate) before starting the server.`,
    );
  }
}

export class PublicApiExposureError extends Error {}

/**
 * ADR-041's standing regression guard, not a one-time fix: Supabase
 * auto-enables RLS and grants anon/authenticated (its own public REST
 * API roles) broad privileges on every NEW table in the public schema —
 * per table, at creation time, not per database. 0013/0014 closed this
 * for the tables that existed when this was found; a future migration
 * that adds a table without knowing about this would silently reopen
 * the exact same exposure. Independent of runMigrations, same ADR-022
 * option (b) reasoning as verifySchemaCurrent — checked on every boot,
 * not just right after a migration runs.
 *
 * Two checks:
 * 1. Every public table is owned by this connection's own role. Not
 *    Supabase-specific — this is what actually lets runMigrations()
 *    (which always runs as the app's own connection role, per ADR-022)
 *    ALTER a table a future migration touches; a table owned by a
 *    different role (e.g. bootstrapped by an admin role and never
 *    transferred, the exact gap ADR-041 hit setting this up the first
 *    time) fails the next ALTER TABLE outright, not just this check.
 * 2. anon/authenticated hold zero grants on any public table. This
 *    query naturally no-ops on Neon or CI's local Postgres — those
 *    roles don't exist there, so they can never appear as a grantee;
 *    no environment-detection branch needed.
 */
export async function verifyNoPublicApiExposure(pool: QueryablePool): Promise<void> {
  const ownerResult = (await pool.query(
    `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tableowner <> current_user`,
  )) as { rows: Array<{ tablename: string; tableowner: string }> };
  if (ownerResult.rows.length > 0) {
    const detail = ownerResult.rows.map((r) => `${r.tablename} (owned by "${r.tableowner}")`).join(", ");
    throw new PublicApiExposureError(
      `Table(s) not owned by this connection's own role: ${detail}. A table this role doesn't own can't be ALTERed by a future migration — transfer ownership (ALTER TABLE ... OWNER TO) before it's used.`,
    );
  }

  const grantResult = (await pool.query(
    `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`,
  )) as { rows: Array<{ table_name: string; grantee: string; privilege_type: string }> };
  if (grantResult.rows.length > 0) {
    const detail = grantResult.rows.map((r) => `${r.table_name}: ${r.grantee} has ${r.privilege_type}`).join(", ");
    throw new PublicApiExposureError(
      `Supabase's anon/authenticated roles hold a grant on public table(s): ${detail}. Supabase re-applies its default grants per table, not per database — a table created since the last fix reopened this. Re-run 0014_revoke_supabase_api_roles.sql's REVOKE pattern against it.`,
    );
  }
}

export function schemaCanaries(): readonly SchemaCanary[] {
  return SCHEMA_CANARIES;
}
