// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// See reservationStore.itest.ts (packages/cost-gate) for how to run this.
import { createPool, insertAuditEvent, runMigrations, withTenantScope } from "@byok/db";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PostgresCostActivityQueries } from "./queries.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the integration suite — see reservationStore.itest.ts.");
}

const pool = createPool({ connectionString: DATABASE_URL, max: 10 });
await runMigrations(pool);

test("spendByRole and spendByTaskType aggregate cost_reservations correctly, scoped to the tenant", async () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const queries = new PostgresCostActivityQueries(pool);

  await withTenantScope(pool, tenantId, async (client) => {
    await client.query(
      `INSERT INTO cost_reservations (tenant_id, role_id, task_type, amount_usd, status) VALUES
       ($1::uuid, 'cfo', 'invoicing', 5, 'settled'),
       ($1::uuid, 'cfo', 'invoicing', 3, 'settled'),
       ($1::uuid, 'cmo', 'outreach', 2, 'settled')`,
      [tenantId],
    );
  });
  await withTenantScope(pool, otherTenantId, async (client) => {
    await client.query(`INSERT INTO cost_reservations (tenant_id, role_id, task_type, amount_usd, status) VALUES ($1::uuid, 'cfo', 'invoicing', 100, 'settled')`, [
      otherTenantId,
    ]);
  });

  const byRole = await queries.spendByRole(tenantId);
  assert.deepEqual(
    byRole.find((r) => r.key === "cfo"),
    { key: "cfo", totalUsd: 8 },
  );
  assert.deepEqual(
    byRole.find((r) => r.key === "cmo"),
    { key: "cmo", totalUsd: 2 },
  );
  assert.equal(byRole.reduce((sum, r) => sum + r.totalUsd, 0), 10, "must not include the other tenant's $100 reservation");

  const byTaskType = await queries.spendByTaskType(tenantId);
  assert.deepEqual(
    byTaskType.find((r) => r.key === "invoicing"),
    { key: "invoicing", totalUsd: 8 },
  );
});

test("autonomyStatus reads back per-task-type autonomy state for the tenant", async () => {
  const tenantId = randomUUID();
  const queries = new PostgresCostActivityQueries(pool);

  await withTenantScope(pool, tenantId, async (client) => {
    await client.query(
      `INSERT INTO autonomy_counters (tenant_id, task_type, consecutive_approvals, active) VALUES ($1::uuid, 'invoicing', 7, true)`,
      [tenantId],
    );
  });

  const status = await queries.autonomyStatus(tenantId);
  assert.deepEqual(status, [{ taskType: "invoicing", active: true, consecutiveApprovals: 7 }]);
});

test("recentActivity reads the unified audit log, newest first, scoped to the tenant", async () => {
  const tenantId = randomUUID();
  const queries = new PostgresCostActivityQueries(pool);

  await withTenantScope(pool, tenantId, async (client) => {
    await insertAuditEvent(client, { tenantId, source: "cost-gate", kind: "reserved", refId: "task-1" });
    await insertAuditEvent(client, { tenantId, source: "approval-queue", kind: "queued", refId: "task-1" });
  });

  const activity = await queries.recentActivity(tenantId);
  assert.equal(activity.length, 2);
  assert.equal(activity[0]?.kind, "queued", "must be ordered newest first");
});
