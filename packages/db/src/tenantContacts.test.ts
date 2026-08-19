import assert from "node:assert/strict";
import { test } from "node:test";
import { getTenantOwnerEmails } from "./tenantContacts.js";
import type { PoolClientLike, PoolLike } from "./tenantContext.js";

const VALID_TENANT_ID = "8b6f3f2e-9a1e-4a5a-9d0f-6f6c1a2b3c4d";

function fakePool(rows: Array<{ email: string }>): PoolLike {
  const client: PoolClientLike = {
    async query(text) {
      if (text.includes("SELECT u.email")) return { rows };
      return undefined;
    },
    release() {},
  };
  return { connect: async () => client };
}

test("returns the emails of owner/admin members, scoped to the given tenant", async () => {
  const pool = fakePool([{ email: "owner@example.com" }, { email: "admin@example.com" }]);
  const emails = await getTenantOwnerEmails(pool, VALID_TENANT_ID);
  assert.deepEqual(emails, ["owner@example.com", "admin@example.com"]);
});

test("returns an empty array, not an error, when the tenant has no owner/admin members", async () => {
  const pool = fakePool([]);
  const emails = await getTenantOwnerEmails(pool, VALID_TENANT_ID);
  assert.deepEqual(emails, []);
});

test("rejects a non-UUID tenant id before ever touching the pool", async () => {
  const pool: PoolLike = {
    connect() {
      throw new Error("pool.connect must not be called for an invalid tenant id");
    },
  };
  await assert.rejects(() => getTenantOwnerEmails(pool, "not-a-uuid"));
});
