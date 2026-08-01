import assert from "node:assert/strict";
import { getTableColumns, getTableName } from "drizzle-orm";
import { test } from "node:test";
import { tenantMembers, tenants, users } from "./schema.js";

test("tenants table shape", () => {
  assert.equal(getTableName(tenants), "tenants");
  const columns = getTableColumns(tenants);
  assert.ok(columns.id.primary);
  assert.equal(columns.slug.notNull, true);
  assert.equal(columns.name.notNull, true);
});

test("users table shape", () => {
  assert.equal(getTableName(users), "users");
  const columns = getTableColumns(users);
  assert.ok(columns.id.primary);
  assert.equal(columns.email.notNull, true);
  assert.equal(columns.name.notNull, false);
});

test("tenant_members carries a required, typed tenant_id foreign key — the RLS join key", () => {
  assert.equal(getTableName(tenantMembers), "tenant_members");
  const columns = getTableColumns(tenantMembers);
  assert.equal(columns.tenantId.notNull, true);
  assert.equal(columns.tenantId.name, "tenant_id");
  assert.equal(columns.userId.notNull, true);
  assert.equal(columns.role.notNull, true);
});
