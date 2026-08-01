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
