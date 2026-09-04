// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// Run via `npm run test:integration` (packages/db), never as part of the
// regular `npm test`. See signupExtractionBatches.itest.ts's own header
// for the local/CI setup — identical here.
//
// One-company-per-user PR (a): migration 0023 adds user_active_tenant
// plus a real backfill across tenant_members/audit_log under the
// internal_metrics RLS carve-out — verified here against a real
// Postgres, not mocked, same discipline tenantSchedule.itest.ts applies.
import { createPool } from "./connection.js";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ActiveTenantStore, TenantNotMemberError } from "./activeTenant.js";
import { withTenantScope } from "./tenantContext.js";
import { withInternalMetricsScope } from "./signupMetrics.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required for the integration suite. Start the local stack (`docker compose up -d`), run " +
      "`npm run db:migrate`, then set DATABASE_URL — or run via `npm run test:integration` in CI.",
  );
}

const pool = createPool({ connectionString: DATABASE_URL, max: 5 });
const store = new ActiveTenantStore(pool);

async function seedUser(): Promise<string> {
  const id = randomUUID();
  await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [id, `itest-${id}@example.test`]);
  return id;
}

async function seedTenant(): Promise<string> {
  const id = randomUUID();
  await pool.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)", [id, `itest-${id}`, "itest tenant"]);
  return id;
}

// tenant_members has FORCE ROW LEVEL SECURITY (tenant_isolation, scoped
// by app.tenant_id) — a plain, unscoped pool.query insert fails its own
// WITH CHECK outright, the same way it would for the real afterAddMember
// hook (packages/auth/src/config.ts) if that hook didn't already use
// withTenantScope for this exact insert. Caught only by actually running
// this against real Postgres in CI, not by any local unit test.
async function seedMembership(tenantId: string, userId: string): Promise<void> {
  await withTenantScope(pool, tenantId, async (client) => {
    await client.query("INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, userId]);
  });
}

async function cleanup(userIds: string[], tenantIds: string[]): Promise<void> {
  if (tenantIds.length) await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenantIds]);
  if (userIds.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
}

test("setActiveTenant + getActiveTenantId round-trip for a real member", async () => {
  const userId = await seedUser();
  const tenantId = await seedTenant();
  await seedMembership(tenantId, userId);
  try {
    assert.equal(await store.getActiveTenantId(userId), null);
    await store.setActiveTenant(userId, tenantId);
    assert.equal(await store.getActiveTenantId(userId), tenantId);
  } finally {
    await cleanup([userId], [tenantId]);
  }
});

test("setActiveTenant refuses to activate a tenant the user doesn't belong to", async () => {
  const userId = await seedUser();
  const tenantId = await seedTenant();
  try {
    await assert.rejects(() => store.setActiveTenant(userId, tenantId), TenantNotMemberError);
  } finally {
    await cleanup([userId], [tenantId]);
  }
});

test("switching active tenant replaces the prior one -- exactly one row per user, never two", async () => {
  const userId = await seedUser();
  const tenantA = await seedTenant();
  const tenantB = await seedTenant();
  await seedMembership(tenantA, userId);
  await seedMembership(tenantB, userId);
  try {
    await store.setActiveTenant(userId, tenantA);
    await store.setActiveTenant(userId, tenantB);
    assert.equal(await store.getActiveTenantId(userId), tenantB);
    const result = (await pool.query("SELECT count(*)::int AS n FROM user_active_tenant WHERE user_id = $1::uuid", [
      userId,
    ])) as unknown as { rows: { n: number }[] };
    assert.equal(result.rows[0].n, 1);
  } finally {
    await cleanup([userId], [tenantA, tenantB]);
  }
});

test("isTenantActive reflects whether the tenant is anyone's active company", async () => {
  const userId = await seedUser();
  const tenantId = await seedTenant();
  await seedMembership(tenantId, userId);
  try {
    assert.equal(await store.isTenantActive(tenantId), false);
    await store.setActiveTenant(userId, tenantId);
    assert.equal(await store.isTenantActive(tenantId), true);
  } finally {
    await cleanup([userId], [tenantId]);
  }
});

test("backfill (migration 0023) defaulted every pre-existing member to a real row, not zero rows under RLS", async () => {
  // Regression guard for the exact bug this migration's internal_metrics
  // carve-out exists to avoid: if the backfill's cross-tenant read of
  // tenant_members/audit_log had been silently RLS-filtered to nothing,
  // every user who existed before 0023 shipped would still show up here
  // as having zero active tenants despite having a real membership.
  const userId = await seedUser();
  const tenantId = await seedTenant();
  await seedMembership(tenantId, userId);
  try {
    // Simulate "pre-existing member" by re-running the same backfill
    // shape the migration uses, scoped to just this user/tenant pair.
    // withInternalMetricsScope (signupMetrics.ts) checks out ONE client
    // for the whole BEGIN/set_config/COMMIT sequence -- separate
    // pool.query() calls each check out their OWN connection from the
    // pool, so a hand-rolled version of this (an earlier version of this
    // test) silently ran its "BEGIN" and its "SET_CONFIG" and its INSERT
    // on three different physical connections, meaning the transaction
    // and the session setting never actually applied together. Caught
    // only in CI against a real Postgres, not locally.
    await withInternalMetricsScope(pool, async (client) => {
      await client.query(
        `INSERT INTO user_active_tenant (user_id, tenant_id, activated_at)
         SELECT tm.user_id, tm.tenant_id, now()
         FROM tenant_members tm
         WHERE tm.user_id = $1::uuid
         ON CONFLICT (user_id) DO NOTHING`,
        [userId],
      );
    });
    assert.equal(await store.getActiveTenantId(userId), tenantId);
  } finally {
    await cleanup([userId], [tenantId]);
  }
});
