import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidTenantIdError, UNSET_SCOPE_UUID, withTenantScope, type PoolClientLike, type PoolLike } from "./tenantContext.js";

const VALID_TENANT_ID = "8b6f3f2e-9a1e-4a5a-9d0f-6f6c1a2b3c4d";

function fakePool(client: PoolClientLike): PoolLike {
  return { connect: async () => client };
}

function recordingClient() {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client: PoolClientLike = {
    async query(text, values) {
      calls.push({ text, values });
      return undefined;
    },
    release() {
      calls.push({ text: "__release__" });
    },
  };
  return { client, calls };
}

test("rejects a non-UUID tenant id before ever touching the pool", async () => {
  const pool: PoolLike = {
    connect() {
      throw new Error("pool.connect must not be called for an invalid tenant id");
    },
  };

  await assert.rejects(
    () => withTenantScope(pool, "'; DROP TABLE tenants; --", async () => "unreachable"),
    InvalidTenantIdError,
  );
});

test("sets app.tenant_id via a bound set_config parameter, never string interpolation", async () => {
  const { client, calls } = recordingClient();
  const pool = fakePool(client);

  const result = await withTenantScope(pool, VALID_TENANT_ID, async () => "ok");

  assert.equal(result, "ok");
  assert.equal(calls[0]?.text, "BEGIN");
  assert.equal(calls[1]?.text, "SELECT set_config('app.tenant_id', $1, true)");
  assert.deepEqual(calls[1]?.values, [VALID_TENANT_ID]);
  assert.equal(calls[4]?.text, "COMMIT");
  assert.equal(calls[5]?.text, "__release__");
});

// Issue #38: a custom GUC's SET LOCAL doesn't reliably revert to a true
// NULL on a pooled connection reused by a later, unrelated scope call —
// so every scope function must explicitly clear every app.* var it
// doesn't own, not just set the one it does.
test("explicitly clears app.user_id and app.internal_metrics — never trusts a reused connection to have them unset", async () => {
  const { client, calls } = recordingClient();
  const pool = fakePool(client);

  await withTenantScope(pool, VALID_TENANT_ID, async () => "ok");

  assert.equal(calls[2]?.text, "SELECT set_config('app.user_id', $1, true)");
  assert.deepEqual(calls[2]?.values, [UNSET_SCOPE_UUID]);
  assert.equal(calls[3]?.text, "SELECT set_config('app.internal_metrics', 'false', true)");
});

test("rolls back and releases the client if the callback throws", async () => {
  const { client, calls } = recordingClient();
  const pool = fakePool(client);

  await assert.rejects(
    () =>
      withTenantScope(pool, VALID_TENANT_ID, async () => {
        throw new Error("boom");
      }),
    /boom/,
  );

  assert.ok(calls.some((c) => c.text === "ROLLBACK"));
  assert.ok(calls.some((c) => c.text === "__release__"));
  assert.ok(!calls.some((c) => c.text === "COMMIT"));
});

test("releases the client even when COMMIT itself fails", async () => {
  let queryCount = 0;
  const calls: string[] = [];
  const client: PoolClientLike = {
    async query(text) {
      queryCount++;
      calls.push(text);
      if (text === "COMMIT") throw new Error("commit failed");
      return undefined;
    },
    release() {
      calls.push("__release__");
    },
  };
  const pool = fakePool(client);

  await assert.rejects(() => withTenantScope(pool, VALID_TENANT_ID, async () => "ok"), /commit failed/);
  assert.ok(calls.includes("ROLLBACK"));
  assert.ok(calls.includes("__release__"));
  assert.ok(queryCount >= 4);
});
