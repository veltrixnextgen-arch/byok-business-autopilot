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
