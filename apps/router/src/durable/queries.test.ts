import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresCostActivityQueries } from "./queries.js";
import type { PoolClientLike, PoolLike } from "@byok/db";

const TENANT_ID = "8b6f3f2e-9a1e-4a5a-9d0f-6f6c1a2b3c4d";

function fakePool(rows: unknown[]): PoolLike {
  const client: PoolClientLike = {
    async query() {
      return { rows };
    },
    release() {},
  };
  return { connect: async () => client };
}

test("activityByTaskType returns task count and total spend per task type", async () => {
  const pool = fakePool([
    { key: "agent-1", task_count: "3", total_usd: "1.500000" },
    { key: "agent-2", task_count: "1", total_usd: "0.050000" },
  ]);
  const queries = new PostgresCostActivityQueries(pool);
  const rows = await queries.activityByTaskType(TENANT_ID, new Date(0));
  assert.deepEqual(rows, [
    { key: "agent-1", taskCount: 3, totalUsd: 1.5 },
    { key: "agent-2", taskCount: 1, totalUsd: 0.05 },
  ]);
});

test("activityByTaskType returns an empty array, not an error, with no activity in the window", async () => {
  const pool = fakePool([]);
  const queries = new PostgresCostActivityQueries(pool);
  const rows = await queries.activityByTaskType(TENANT_ID, new Date());
  assert.deepEqual(rows, []);
});

test("autonomyStatus surfaces offeredAt, and null when no offer is pending", async () => {
  const pool = fakePool([
    { task_type: "agent-1", active: false, consecutive_approvals: 10, offered_at: "2026-08-20T00:00:00.000Z" },
    { task_type: "agent-2", active: true, consecutive_approvals: 3, offered_at: null },
  ]);
  const queries = new PostgresCostActivityQueries(pool);
  const rows = await queries.autonomyStatus(TENANT_ID);
  assert.deepEqual(rows, [
    { taskType: "agent-1", active: false, consecutiveApprovals: 10, offeredAt: "2026-08-20T00:00:00.000Z" },
    { taskType: "agent-2", active: true, consecutiveApprovals: 3, offeredAt: null },
  ]);
});

// #149/#150 put Vault's own audit_log rows (source="vault") in the same
// shared table this feed reads — recentActivity's own documented purpose
// is queue/gate activity, not Vault's security trail, so the query must
// keep excluding it explicitly, not rely on nothing ever writing there.
test("recentActivity's query excludes Vault's own audit_log rows (source=\"vault\")", async () => {
  // withTenantScope wraps the real query in BEGIN/set_config/COMMIT calls
  // on the same client — capture every call, not just the last one.
  const capturedSql: string[] = [];
  const client: PoolClientLike = {
    async query(sql: string) {
      capturedSql.push(sql);
      return { rows: [] };
    },
    release() {},
  };
  const pool: PoolLike = { connect: async () => client };
  const queries = new PostgresCostActivityQueries(pool);
  await queries.recentActivity(TENANT_ID);
  assert.ok(
    capturedSql.some((sql) => /source IN \('cost-gate', 'approval-queue'\)/.test(sql)),
    "expected the SELECT to filter out source='vault'",
  );
});

test("costByRefIds maps each ref id to its real reserved amount", async () => {
  const pool = fakePool([
    { ref_id: "task-1", amount_usd: "0.049500" },
    { ref_id: "task-2", amount_usd: "1.200000" },
  ]);
  const queries = new PostgresCostActivityQueries(pool);
  const costs = await queries.costByRefIds(TENANT_ID, ["task-1", "task-2", "task-3"]);
  assert.deepEqual(costs, { "task-1": 0.0495, "task-2": 1.2 });
  assert.equal("task-3" in costs, false); // no matching row — absent, not zeroed
});

test("costByRefIds returns an empty object without touching the pool when given no ids", async () => {
  const pool: PoolLike = {
    connect() {
      throw new Error("pool.connect must not be called for an empty refIds list");
    },
  };
  const queries = new PostgresCostActivityQueries(pool);
  const costs = await queries.costByRefIds(TENANT_ID, []);
  assert.deepEqual(costs, {});
});
