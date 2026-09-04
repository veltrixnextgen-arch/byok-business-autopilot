import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  migrationFiles,
  migrationsDir,
  PublicApiExposureError,
  runMigrations,
  schemaCanaries,
  SchemaDriftError,
  verifyNoPublicApiExposure,
  verifySchemaCurrent,
} from "./migrate.js";

// ADR-022: migrations run on every boot now, wrapped in a Postgres
// advisory lock so concurrent replicas serialize rather than race DDL —
// see migrate.ts's own comment on why DROP POLICY IF EXISTS + CREATE
// POLICY specifically isn't safe to race, unlike the IF NOT EXISTS
// statements elsewhere in these files.
test("runMigrations applies every migration file, in order, bracketed by an advisory lock/unlock", async () => {
  const applied: string[] = [];
  await runMigrations({
    async query(text) {
      applied.push(text);
    },
  });

  assert.equal(applied.length, migrationFiles().length + 2);
  assert.match(applied[0] ?? "", /pg_advisory_lock/);
  assert.ok(applied[1]?.includes("CREATE TABLE IF NOT EXISTS tenants"));
  assert.match(applied[applied.length - 1] ?? "", /pg_advisory_unlock/);
});

test("runMigrations releases the advisory lock even if a migration throws — never left held forever", async () => {
  const calls: string[] = [];
  await assert.rejects(
    runMigrations({
      async query(text) {
        calls.push(text);
        if (text.includes("CREATE TABLE IF NOT EXISTS tenants")) throw new Error("simulated migration failure");
      },
    }),
    /simulated migration failure/,
  );

  assert.match(calls[calls.length - 1] ?? "", /pg_advisory_unlock/, "unlock must still run after a migration throws");
});

test("0001_init.sql enables and forces RLS with a bound-setting policy for every tenant-scoped table", async () => {
  const sql = await readFile(path.join(migrationsDir(), "0001_init.sql"), "utf8");

  // tenant_members is the one tenant-scoped table today; this assertion is
  // intentionally literal so it breaks (loudly) if a future tenant-scoped
  // table is added to schema.ts without a matching RLS policy here.
  assert.match(sql, /ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE tenant_members FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE POLICY tenant_isolation ON tenant_members/);
  assert.match(sql, /current_setting\('app\.tenant_id', true\)::uuid/);
  assert.match(sql, /WITH CHECK \(tenant_id = current_setting\('app\.tenant_id', true\)::uuid\)/);
});

test("0002_durable_storage.sql RLS-policies every tenant-scoped table it creates", async () => {
  const sql = await readFile(path.join(migrationsDir(), "0002_durable_storage.sql"), "utf8");

  // Every table this migration creates carries a tenant_id column and must
  // be locked down the same way — this list is intentionally literal so
  // adding a table here without a matching policy fails this test loudly.
  const tenantScopedTables = [
    "cost_ledger_counters",
    "cost_reservations",
    "router_tasks",
    "task_ledger_entries",
    "approval_queue_items",
    "autonomy_counters",
    "paused_batches",
    "audit_log",
  ];

  for (const table of tenantScopedTables) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`), `${table}: missing ENABLE RLS`);
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`), `${table}: missing FORCE RLS`);
    assert.match(sql, new RegExp(`CREATE POLICY tenant_isolation ON ${table}`), `${table}: missing tenant_isolation policy`);
  }
});

test("0004_signup_extraction_batches.sql enables and forces RLS keyed on app.user_id, not app.tenant_id", async () => {
  const sql = await readFile(path.join(migrationsDir(), "0004_signup_extraction_batches.sql"), "utf8");

  // This table is deliberately NOT tenant-scoped (ADR-015 — it's written
  // before any tenant exists), so it must NOT reuse the tenant_isolation
  // policy name or app.tenant_id — a copy-paste of the tenant pattern here
  // would silently defeat isolation (every user sharing whatever
  // app.tenant_id happens to be set, or none at all).
  assert.match(sql, /ALTER TABLE signup_extraction_batches ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE signup_extraction_batches FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE POLICY user_isolation ON signup_extraction_batches/);
  assert.match(sql, /current_setting\('app\.user_id', true\)::uuid/);
  assert.match(sql, /WITH CHECK \(user_id = current_setting\('app\.user_id', true\)::uuid\)/);
  assert.doesNotMatch(sql, /app\.tenant_id/);
});

test("0005_signup_metrics.sql RLS-policies both tables it creates, keyed on app.user_id with an internal-metrics read exception", async () => {
  const sql = await readFile(path.join(migrationsDir(), "0005_signup_metrics.sql"), "utf8");

  for (const table of ["signup_funnel_events", "signup_feedback"]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`), `${table}: missing ENABLE RLS`);
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`), `${table}: missing FORCE RLS`);
    assert.match(sql, new RegExp(`CREATE POLICY user_isolation ON ${table}`), `${table}: missing user_isolation policy`);
  }

  // Also re-declares signup_extraction_batches' (0004) policy to add the
  // same read exception, since the metrics view needs per-signup cost —
  // a new migration re-declaring an existing policy name, not an edit to
  // 0004's already-applied file.
  assert.match(sql, /CREATE POLICY user_isolation ON signup_extraction_batches/);

  // The internal-metrics read exception must never appear in a WITH CHECK
  // clause — that would let a tester's own session insert or update rows
  // under someone else's user_id by also setting app.internal_metrics,
  // not just read across users.
  const withChecks = sql.match(/WITH CHECK \([^)]*\)/g) ?? [];
  assert.ok(withChecks.length === 3, "expected exactly one WITH CHECK per policy (3 tables touched)");
  for (const clause of withChecks) {
    assert.doesNotMatch(clause, /internal_metrics/);
  }
});

test("0006_signup_extraction_batch_tenant_transfer.sql adds tenant_id and closes the user_id path once a row is claimed", async () => {
  const sql = await readFile(path.join(migrationsDir(), "0006_signup_extraction_batch_tenant_transfer.sql"), "utf8");

  assert.match(sql, /ALTER TABLE signup_extraction_batches\s+ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants\(id\)/);
  assert.match(sql, /DROP POLICY IF EXISTS user_isolation ON signup_extraction_batches;/);
  // Found live on staging's first redeploy since ADR-022 made migrations
  // run on every boot: this migration originally dropped ONLY
  // user_isolation before creating owner_isolation, never itself —
  // CREATE POLICY has no IF NOT EXISTS, so re-running this file (which
  // happens on every subsequent boot, not just the first) failed with
  // "policy owner_isolation ... already exists" and blocked every
  // migration after it. A later migration re-declaring the policy can't
  // fix this: migrations run unconditionally in order, so 0006 itself
  // throws before a fix-up file ever gets a chance to run — the fix has
  // to live here, in the file that's actually broken.
  assert.match(sql, /DROP POLICY IF EXISTS owner_isolation ON signup_extraction_batches;\s*\nCREATE POLICY owner_isolation ON signup_extraction_batches/);

  // Pre-claim: exactly the 0004/0005 user-scoped behavior. Post-claim: a
  // real tenant-scoped branch, matching every other tenant-scoped table.
  assert.match(sql, /tenant_id IS NULL AND user_id = current_setting\('app\.user_id', true\)::uuid/);
  assert.match(sql, /tenant_id IS NOT NULL AND tenant_id = current_setting\('app\.tenant_id', true\)::uuid/);

  // The 0005 internal-metrics read exception must survive this migration,
  // and must appear exactly once in actual SQL — in USING, never
  // duplicated into WITH CHECK (which would let it write, not just read,
  // across owners). Matches the functional condition only, not comments.
  const internalMetricsConditions = sql.match(/current_setting\('app\.internal_metrics', true\) = 'true'/g) ?? [];
  assert.equal(internalMetricsConditions.length, 1, "app.internal_metrics condition must appear in USING only, never in WITH CHECK");

  // One claimed chart per tenant, enforced at the database level, not
  // just by claimLatestForTenant's own idempotency check.
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS signup_extraction_batches_tenant_id_unique/);
});

// ADR-022 option (b): a boot-time check independent of whether
// runMigrations ran (or ran successfully) this boot — regression coverage
// for the exact incident that prompted it (2026-08-12: migrations 0006/0007
// silently never ran against staging for four days across eleven merged
// PRs; the app booted and served requests anyway, failing only on the
// first real query that touched a missing column).
function fakeInformationSchemaPool(columnsByTable: Record<string, string[]>) {
  return {
    async query(text: string) {
      const match = text.match(/table_name = '([^']+)'/);
      const table = match?.[1];
      const columns: string[] = table ? (columnsByTable[table] ?? []) : [];
      return { rows: columns.map((column_name) => ({ column_name })) };
    },
  };
}

test("verifySchemaCurrent resolves cleanly when every canary column is present", async () => {
  const pool = fakeInformationSchemaPool({
    signup_extraction_batches: ["id", "user_id", "tenant_id"],
    tenants: ["id", "slug", "monthly_ceiling_usd", "tier"],
    router_tasks: ["id", "tenant_id", "prompt_tier"],
  });
  await assert.doesNotReject(() => verifySchemaCurrent(pool));
});

test("verifySchemaCurrent throws SchemaDriftError naming the exact missing column and which migration adds it", async () => {
  const pool = fakeInformationSchemaPool({
    signup_extraction_batches: ["id", "user_id"], // tenant_id missing, as it was on real staging
    tenants: ["id", "slug", "monthly_ceiling_usd", "tier"],
    router_tasks: ["id", "tenant_id", "prompt_tier"],
  });
  await assert.rejects(
    () => verifySchemaCurrent(pool),
    (err: unknown) =>
      err instanceof SchemaDriftError &&
      /signup_extraction_batches\.tenant_id/.test(err.message) &&
      /0006_signup_extraction_batch_tenant_transfer\.sql/.test(err.message),
  );
});

test("verifySchemaCurrent reports every missing canary at once, not just the first", async () => {
  const pool = fakeInformationSchemaPool({ signup_extraction_batches: ["id"], tenants: ["id"], router_tasks: ["id"] });
  await assert.rejects(
    () => verifySchemaCurrent(pool),
    (err: unknown) =>
      err instanceof SchemaDriftError &&
      /tenant_id/.test(err.message) &&
      /monthly_ceiling_usd/.test(err.message) &&
      /prompt_tier/.test(err.message) &&
      /tenants\.tier/.test(err.message),
  );
});

// ADR-041: standing regression guard, not a one-time fix — Supabase
// re-applies its anon/authenticated default grants and RLS-auto-enable
// per table, not per database, so a future migration adding a table
// could silently reopen the exact exposure 0013/0014 closed.
function fakeExposurePool(opts: { mismatchedOwners?: Array<{ tablename: string; tableowner: string }>; grants?: Array<{ table_name: string; grantee: string; privilege_type: string }> }) {
  return {
    async query(text: string) {
      if (text.includes("pg_tables")) return { rows: opts.mismatchedOwners ?? [] };
      if (text.includes("role_table_grants")) return { rows: opts.grants ?? [] };
      throw new Error(`fakeExposurePool: unexpected query: ${text}`);
    },
  };
}

test("verifyNoPublicApiExposure resolves cleanly with no ownership mismatch and no anon/authenticated grants", async () => {
  const pool = fakeExposurePool({});
  await assert.doesNotReject(() => verifyNoPublicApiExposure(pool));
});

test("verifyNoPublicApiExposure resolves cleanly when anon/authenticated don't exist at all (Neon, CI's local Postgres) — the grant query naturally returns nothing, no environment branch needed", async () => {
  const pool = fakeExposurePool({ grants: [] });
  await assert.doesNotReject(() => verifyNoPublicApiExposure(pool));
});

test("verifyNoPublicApiExposure throws PublicApiExposureError naming a table not owned by this connection's own role", async () => {
  const pool = fakeExposurePool({ mismatchedOwners: [{ tablename: "widgets", tableowner: "postgres" }] });
  await assert.rejects(
    () => verifyNoPublicApiExposure(pool),
    (err: unknown) => err instanceof PublicApiExposureError && /widgets/.test(err.message) && /"postgres"/.test(err.message),
  );
});

test("verifyNoPublicApiExposure throws PublicApiExposureError naming a table anon/authenticated still has a grant on", async () => {
  const pool = fakeExposurePool({ grants: [{ table_name: "widgets", grantee: "anon", privilege_type: "SELECT" }] });
  await assert.rejects(
    () => verifyNoPublicApiExposure(pool),
    (err: unknown) => err instanceof PublicApiExposureError && /widgets/.test(err.message) && /anon/.test(err.message) && /SELECT/.test(err.message),
  );
});

test("0011_vault_durable_storage.sql RLS-policies every tenant-scoped table it creates", async () => {
  const sql = await readFile(path.join(migrationsDir(), "0011_vault_durable_storage.sql"), "utf8");

  const tenantScopedTables = ["tenant_deks", "brain_keys", "hands_keys"];
  for (const table of tenantScopedTables) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`), `${table}: missing ENABLE RLS`);
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`), `${table}: missing FORCE RLS`);
    assert.match(sql, new RegExp(`CREATE POLICY tenant_isolation ON ${table}`), `${table}: missing tenant_isolation policy`);
  }

  // Every material/DEK column must be BYTEA (raw ciphertext bytes), never
  // a text type that could tempt a future caller into storing something
  // human-readable there — the whole point of this migration.
  for (const column of ["encrypted_dek_ciphertext", "encrypted_dek_iv", "encrypted_dek_auth_tag", "material_ciphertext", "material_iv", "material_auth_tag"]) {
    assert.match(sql, new RegExp(`${column}\\s+BYTEA`), `${column}: must be declared BYTEA`);
  }
});

test("0023_user_active_tenant.sql adds the internal_metrics read exception to tenant_members/audit_log, never in a WITH CHECK", async () => {
  const sql = await readFile(path.join(migrationsDir(), "0023_user_active_tenant.sql"), "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_active_tenant/);
  assert.match(sql, /CREATE POLICY internal_metrics_read ON tenant_members/);
  assert.match(sql, /CREATE POLICY internal_metrics_read ON audit_log/);

  // Same invariant 0005/0006 already enforce for their own internal-metrics
  // exceptions: it must only ever appear in USING, never WITH CHECK — this
  // is a SELECT-only carve-out, so it must never grant a write path.
  const internalMetricsConditions = sql.match(/current_setting\('app\.internal_metrics', true\) = 'true'/g) ?? [];
  assert.equal(internalMetricsConditions.length, 2, "expected exactly one internal_metrics condition per policy (2 tables touched)");
  const withChecks = sql.match(/WITH CHECK \([^)]*\)/g) ?? [];
  for (const clause of withChecks) {
    assert.doesNotMatch(clause, /internal_metrics/);
  }

  // The backfill's set_config must be transaction-local (`true`), not
  // session-level — a session-level set on a pooled connection would leak
  // the internal_metrics bypass onto a later, unrelated query reusing the
  // same physical connection after this migration's pool.query() call
  // returns it. And it must be bracketed by an explicit BEGIN/COMMIT, since
  // that's what actually gives set_config's `true` (is_local) form a
  // transaction boundary to revert at.
  assert.match(sql, /SELECT set_config\('app\.internal_metrics', 'true', true\);/);
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
});

test("schemaCanaries names exactly the four ALTER TABLE ADD COLUMN migrations that exist today", () => {
  const canaries = schemaCanaries();
  assert.deepEqual(
    canaries.map((c) => `${c.table}.${c.column}`),
    ["signup_extraction_batches.tenant_id", "tenants.monthly_ceiling_usd", "router_tasks.prompt_tier", "tenants.tier"],
  );
});
