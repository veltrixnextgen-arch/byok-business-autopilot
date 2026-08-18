import assert from "node:assert/strict";
import { test } from "node:test";
import { createPool } from "./connection.js";

// pg.Pool emits 'error' when an idle client (already released back to the
// pool) hits a connection-level problem -- separate from a client that's
// actively mid-query. Node's default behavior for an unhandled
// EventEmitter 'error' event is to throw synchronously, crashing the
// whole process. This is the exact mechanism behind the "idle-in-
// transaction timeout" crashes found in staging: a single poisoned idle
// connection took down the API for every tenant. createPool must attach
// its own listener so that event is logged and swallowed, not left to
// Node's default throw.
test("createPool attaches an 'error' listener so an idle client error doesn't crash the process", () => {
  const pool = createPool({ connectionString: "postgres://user:pass@localhost:5432/db" });
  try {
    assert.doesNotThrow(() => {
      pool.emit("error", new Error("simulated idle client error"));
    });
  } finally {
    // No real connection was ever opened (no query/connect call above), so
    // this just tears down the Pool's internal timers/handles.
    void pool.end();
  }
});
