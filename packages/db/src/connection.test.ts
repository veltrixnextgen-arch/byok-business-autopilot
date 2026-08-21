import assert from "node:assert/strict";
import { test } from "node:test";
import { createPool, logSlowConnectionWait } from "./connection.js";

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

// ADR-030: a live incident found createPool never set
// connectionTimeoutMillis -- a caller waiting for a saturated pool waited
// forever, no error, no log, nothing to observe except every downstream
// query also hanging. The same class of bug ADR-027 already fixed for
// the Redis connection. These three bounds close it for Postgres too.
test("createPool sets connectionTimeoutMillis/statement_timeout/idle_in_transaction_session_timeout to real, bounded defaults", () => {
  const pool = createPool({ connectionString: "postgres://user:pass@localhost:5432/db" });
  try {
    assert.equal(pool.options.connectionTimeoutMillis, 10_000);
    assert.equal(pool.options.statement_timeout, 30_000);
    assert.equal(pool.options.idle_in_transaction_session_timeout, 30_000);
  } finally {
    void pool.end();
  }
});

test("createPool lets a caller override any of the three bounds", () => {
  const pool = createPool({
    connectionString: "postgres://user:pass@localhost:5432/db",
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: 15_000,
    idleInTransactionSessionTimeoutMillis: 45_000,
  });
  try {
    assert.equal(pool.options.connectionTimeoutMillis, 5_000);
    assert.equal(pool.options.statement_timeout, 15_000);
    assert.equal(pool.options.idle_in_transaction_session_timeout, 45_000);
  } finally {
    void pool.end();
  }
});

test("createPool defaults max to 10, same as before this change", () => {
  const pool = createPool({ connectionString: "postgres://user:pass@localhost:5432/db" });
  try {
    assert.equal(pool.options.max, 10);
  } finally {
    void pool.end();
  }
});

// logSlowConnectionWait is the pure predicate behind the pool-saturation
// warning -- tested directly (no real pool.connect() call, no live
// Postgres needed) by capturing console.warn.
test("logSlowConnectionWait warns loudly when a connection wait exceeds the threshold", () => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    logSlowConnectionWait(2_500, 10, 2_000);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /waited 2500ms.*pool saturated.*max=10/);
});

test("logSlowConnectionWait says nothing for a wait at or under the threshold", () => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    logSlowConnectionWait(1_000, 10, 2_000);
    logSlowConnectionWait(2_000, 10, 2_000);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 0);
});
