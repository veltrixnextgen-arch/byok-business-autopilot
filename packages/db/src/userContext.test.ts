import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidUserIdError, withUserScope } from "./userContext.js";
import type { PoolClientLike, PoolLike } from "./tenantContext.js";

const VALID_USER_ID = "8b6f3f2e-9a1e-4a5a-9d0f-6f6c1a2b3c4d";

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

test("rejects a non-UUID user id before ever touching the pool", async () => {
  const pool: PoolLike = {
    connect() {
      throw new Error("pool.connect must not be called for an invalid user id");
    },
  };

  await assert.rejects(
    () => withUserScope(pool, "'; DROP TABLE users; --", async () => "unreachable"),
    InvalidUserIdError,
  );
});

test("sets app.user_id via a bound set_config parameter, never string interpolation", async () => {
  const { client, calls } = recordingClient();
  const pool = fakePool(client);

  const result = await withUserScope(pool, VALID_USER_ID, async () => "ok");

  assert.equal(result, "ok");
  assert.equal(calls[0]?.text, "BEGIN");
  assert.equal(calls[1]?.text, "SELECT set_config('app.user_id', $1, true)");
  assert.deepEqual(calls[1]?.values, [VALID_USER_ID]);
  assert.equal(calls[2]?.text, "COMMIT");
  assert.equal(calls[3]?.text, "__release__");
});

test("rolls back and releases the client if the callback throws", async () => {
  const { client, calls } = recordingClient();
  const pool = fakePool(client);

  await assert.rejects(
    () =>
      withUserScope(pool, VALID_USER_ID, async () => {
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

  await assert.rejects(() => withUserScope(pool, VALID_USER_ID, async () => "ok"), /commit failed/);
  assert.ok(calls.includes("ROLLBACK"));
  assert.ok(calls.includes("__release__"));
  assert.ok(queryCount >= 4);
});
