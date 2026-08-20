import assert from "node:assert/strict";
import { test } from "node:test";
import { listAllTenantIds } from "./tenants.js";
import type { PoolClientLike, PoolLike } from "./tenantContext.js";

function fakePool(rows: Array<{ id: string }>): PoolLike {
  const client: PoolClientLike = {
    async query(text) {
      if (text.includes("FROM tenants")) return { rows };
      return { rows: [] };
    },
    release() {},
  };
  return { connect: async () => client };
}

test("returns every tenant id, no tenant scoping applied", async () => {
  const pool = fakePool([{ id: "tenant-1" }, { id: "tenant-2" }]);
  const ids = await listAllTenantIds(pool);
  assert.deepEqual(ids, ["tenant-1", "tenant-2"]);
});

test("returns an empty array, not an error, when there are no tenants", async () => {
  const pool = fakePool([]);
  const ids = await listAllTenantIds(pool);
  assert.deepEqual(ids, []);
});

test("releases the client even if the query throws", async () => {
  let released = false;
  const client: PoolClientLike = {
    async query() {
      throw new Error("boom");
    },
    release() {
      released = true;
    },
  };
  const pool: PoolLike = { connect: async () => client };
  await assert.rejects(() => listAllTenantIds(pool));
  assert.equal(released, true);
});
