import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { migrationFiles, migrationsDir, runMigrations } from "./migrate.js";

test("runMigrations applies every migration file, in order, against the pool", async () => {
  const applied: string[] = [];
  await runMigrations({
    async query(text) {
      applied.push(text);
    },
  });

  assert.equal(applied.length, migrationFiles().length);
  assert.ok(applied[0]?.includes("CREATE TABLE IF NOT EXISTS tenants"));
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
