// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// See packages/cost-gate/src/durable/reservationStore.itest.ts for how to
// run this.
import { createPool } from "@byok/db";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PostgresDurableAutonomyStore } from "./autonomyStore.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the integration suite — see reservationStore.itest.ts.");
}

const pool = createPool({ connectionString: DATABASE_URL, max: 20 });

test("concurrent approvals for the same (tenant, task type) never lose an increment — the row lock serializes them", async () => {
  const tenantId = randomUUID();
  const store = new PostgresDurableAutonomyStore(pool, { offerThreshold: 1000, spotCheckRate: 0 });

  // 25 genuinely concurrent recordApproval calls, each acquiring its own
  // connection. Without the row-locked UPDATE, two concurrent increments
  // could both read consecutive_approvals=N and both write N+1, losing one.
  await Promise.all(Array.from({ length: 25 }, () => store.recordApproval(tenantId, "invoicing", [])));

  const state = await store.stateFor(tenantId, "invoicing");
  assert.equal(state.consecutiveApprovals, 25, "every concurrent approval must be counted — none lost to a lost-update race");
});

test("the autonomy offer fires exactly once even when many concurrent approvals cross the threshold together", async () => {
  const tenantId = randomUUID();
  const store = new PostgresDurableAutonomyStore(pool, { offerThreshold: 10, spotCheckRate: 0 });

  const results = await Promise.all(Array.from({ length: 20 }, () => store.recordApproval(tenantId, "invoicing", [])));
  const offeredCount = results.filter((r) => r.offered).length;

  assert.equal(offeredCount, 1, "the offer must fire on exactly the call that takes the count to the threshold, exactly once");
});

test("RLS: autonomy state is isolated per tenant even under concurrent writes", async () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const store = new PostgresDurableAutonomyStore(pool, { offerThreshold: 1000, spotCheckRate: 0 });

  await Promise.all([
    ...Array.from({ length: 5 }, () => store.recordApproval(tenantA, "invoicing", [])),
    ...Array.from({ length: 3 }, () => store.recordApproval(tenantB, "invoicing", [])),
  ]);

  const stateA = await store.stateFor(tenantA, "invoicing");
  const stateB = await store.stateFor(tenantB, "invoicing");
  assert.equal(stateA.consecutiveApprovals, 5);
  assert.equal(stateB.consecutiveApprovals, 3);
});

// The million-approval deny-list guarantee (autonomyStore.test.ts, ported
// from the old AutonomyEngine suite) is proven cheaply in-memory — running
// a literal million real Postgres round-trips here would be impractical
// for CI. What actually needs proving against the real database is
// different and smaller: the deny-list check (isDeniable) happens BEFORE
// any query at all (recordApproval's `if (this.isDeniable(...)) return
// ...` short-circuit), so a deny-listed approval must never even create a
// row, let alone increment one.
test("deny-list immunity holds against Postgres too: a deny-listed approval never creates or mutates a row", async () => {
  const tenantId = randomUUID();
  const store = new PostgresDurableAutonomyStore(pool, { offerThreshold: 1, spotCheckRate: 0 });

  for (let i = 0; i < 5; i++) {
    const result = await store.recordApproval(tenantId, "payments", ["money-movement"]);
    assert.equal(result.offered, false);
  }

  const state = await store.stateFor(tenantId, "payments");
  assert.equal(state.consecutiveApprovals, 0, "no row should have been created/incremented for a deny-listed task type");
  assert.equal(state.active, false);
});
