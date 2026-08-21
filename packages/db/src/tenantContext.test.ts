import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidTenantIdError, timedConnect, UNSET_SCOPE_UUID, withTenantScope, type PoolClientLike, type PoolLike } from "./tenantContext.js";

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

// A real pg.PoolClient discards the underlying connection instead of
// returning it to the pool when release() is passed a truthy error — skip
// this and a connection that's still mid-transaction (because ROLLBACK
// itself couldn't run, e.g. the connection is already broken) goes back
// into the pool for a later, unrelated caller to inherit, which is exactly
// the shape of bug that leaves a session idling inside an open transaction
// until Neon's idle_in_transaction_session_timeout kills it and crashes
// the whole process.
test("releases the client WITH the original error, so pg.Pool discards it rather than reusing it", async () => {
  const { client, calls } = recordingClient();
  const pool = fakePool(client);
  const boom = new Error("boom");
  let releasedWith: unknown;
  client.release = (err?: unknown) => {
    releasedWith = err;
    calls.push({ text: "__release__" });
  };

  await assert.rejects(
    () =>
      withTenantScope(pool, VALID_TENANT_ID, async () => {
        throw boom;
      }),
    /boom/,
  );

  assert.equal(releasedWith, boom);
});

test("still discards the connection (release with the original error) even when ROLLBACK itself fails", async () => {
  const calls: string[] = [];
  let releasedWith: unknown;
  const boom = new Error("boom");
  const client: PoolClientLike = {
    async query(text) {
      calls.push(text);
      if (text === "ROLLBACK") throw new Error("connection already broken");
      return undefined;
    },
    release(err?: unknown) {
      releasedWith = err;
      calls.push("__release__");
    },
  };
  const pool = fakePool(client);

  await assert.rejects(
    () =>
      withTenantScope(pool, VALID_TENANT_ID, async () => {
        throw boom;
      }),
    /boom/,
  );

  assert.ok(calls.includes("__release__"));
  assert.equal(releasedWith, boom);
});

// ADR-030: timedConnect is the shared instrumentation point every scope
// function (withTenantScope above, withUserScope/withUserAndTenantScope/
// withInternalMetricsScope, listAllTenantIds) uses instead of calling
// pool.connect() directly -- deliberately NOT done by overriding pg.Pool's
// own connect() method (that broke pool.query()'s internal callback-style
// use of connect(), found live). Timing the call site itself, as this
// does, never touches pg-pool's own internals -- verified here with a
// fake PoolLike, no real Postgres involved.
test("timedConnect returns whatever pool.connect() resolves to, unchanged", async () => {
  const fakeClient = {} as PoolClientLike;
  const pool: PoolLike = { connect: async () => fakeClient };

  const client = await timedConnect(pool);

  assert.equal(client, fakeClient);
});

test("timedConnect logs loudly when pool.connect() itself takes a while, without swallowing or delaying the result", async () => {
  const fakeClient = {} as PoolClientLike;
  const pool: PoolLike = {
    connect: () => new Promise((resolve) => setTimeout(() => resolve(fakeClient), 20)),
  };
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);

  let client: PoolClientLike;
  try {
    client = await timedConnect(pool);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(client, fakeClient);
  // logSlowConnectionWait's own default threshold (2s) is far above this
  // test's 20ms delay -- nothing should have been logged for a fast wait.
  assert.equal(warnings.length, 0);
});
