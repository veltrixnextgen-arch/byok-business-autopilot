// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// Run via `npm run test:integration` (packages/cost-gate), never as part
// of the regular `npm test`. Locally: `docker compose up -d` then
// `npm run db:migrate` from repo root. In CI: a Postgres service
// container, migrated before this runs — see .github/workflows/ci.yml.
import { createPool, runMigrations } from "@byok/db";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { CeilingConfig } from "../ceilings.js";
import { PostgresReservationStore } from "./reservationStore.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required for the integration suite. Start the local stack (`docker compose up -d`) and set DATABASE_URL, " +
      "or run this via `npm run test:integration` in CI where a Postgres service container provides it.",
  );
}

const pool = createPool({ connectionString: DATABASE_URL, max: 20 });

// Real migrations only need to run once per test process, and this file is
// the only one hitting the DB in this package's integration suite today.
await runMigrations(pool);

function ceilings(companyMonthlyUsd: number): CeilingConfig {
  return { companyMonthlyUsd, perRoleUsd: {}, perTaskTypeUsd: {} };
}

test("THE atomicity fix: two genuinely concurrent Postgres connections racing a nearly-exhausted budget — exactly one wins", async () => {
  const tenantId = randomUUID();
  const store = new PostgresReservationStore(pool);
  const budget = 15;

  // Two separate reserveAtomic calls, launched together via Promise.all so
  // they overlap in wall-clock time, each acquiring its OWN connection
  // from the pool (withTenantScope calls pool.connect() internally) — this
  // is genuinely two concurrent Postgres transactions, not two JS
  // event-loop turns sharing one in-process Map. $10 + $10 = $20 > $15:
  // if the check-then-reserve sequence were not atomic at the database
  // level, both could observe "$0 reserved so far" and both succeed.
  const [a, b] = await Promise.all([
    store.reserveAtomic({ tenantId, taskId: "task-a", roleId: "cfo", taskType: "invoicing", amountUsd: 10 }, ceilings(budget)),
    store.reserveAtomic({ tenantId, taskId: "task-b", roleId: "cfo", taskType: "invoicing", amountUsd: 10 }, ceilings(budget)),
  ]);

  const outcomes = [a, b];
  const admitted = outcomes.filter((o) => o.withinCeiling);
  const rejected = outcomes.filter((o) => !o.withinCeiling);

  assert.equal(admitted.length, 1, "exactly one of the two concurrent reservations must be admitted");
  assert.equal(rejected.length, 1, "exactly one must be rejected for exceeding the company ceiling");
  assert.equal(rejected[0]?.exceededLevel, "company");

  const totals = await store.totals(tenantId, "company", "company");
  assert.equal(totals.totalUsd, 10, "the database's running total must reflect only the admitted reservation, never both");
});

test("many genuinely concurrent reservations against a tight budget never double-count past it", async () => {
  const tenantId = randomUUID();
  const store = new PostgresReservationStore(pool);
  const budget = 1.0;
  const perTaskCost = 0.11; // 10 would blow past 1.0; at most 9 should fit

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      store.reserveAtomic(
        { tenantId, taskId: `task-${i}`, roleId: "cfo", taskType: "invoicing", amountUsd: perTaskCost },
        ceilings(budget),
      ),
    ),
  );

  const admittedCount = results.filter((r) => r.withinCeiling).length;
  const totals = await store.totals(tenantId, "company", "company");

  assert.ok(totals.totalUsd <= budget + 1e-9, `database total $${totals.totalUsd} exceeded budget $${budget}`);
  assert.ok(admittedCount <= 9, `admitted ${admittedCount} reservations at $${perTaskCost} each — more than fit in $${budget}`);
  assert.ok(admittedCount > 0, "at least some reservations should have been admitted");
});

test("settle() adjusts the durable total by the estimate-vs-actual delta, verified via a fresh read", async () => {
  const tenantId = randomUUID();
  const store = new PostgresReservationStore(pool);

  const reserved = await store.reserveAtomic(
    { tenantId, taskId: "task-1", roleId: "cfo", taskType: "invoicing", amountUsd: 10 },
    ceilings(100),
  );
  assert.ok(reserved.reservationId);

  await store.settle(tenantId, reserved.reservationId!, 3);

  const totals = await store.totals(tenantId, "company", "company");
  assert.equal(totals.totalUsd, 3);
});

test("release() frees the reserved amount back up, verified via a fresh read", async () => {
  const tenantId = randomUUID();
  const store = new PostgresReservationStore(pool);

  const reserved = await store.reserveAtomic(
    { tenantId, taskId: "task-1", roleId: "cfo", taskType: "invoicing", amountUsd: 10 },
    ceilings(100),
  );
  await store.release(tenantId, reserved.reservationId!);

  const totals = await store.totals(tenantId, "company", "company");
  assert.equal(totals.totalUsd, 0);
});

test("RLS: a session scoped to a different tenant cannot see another tenant's reservations", async () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const store = new PostgresReservationStore(pool);

  await store.reserveAtomic({ tenantId: tenantA, taskId: "task-1", roleId: "cfo", taskType: "invoicing", amountUsd: 10 }, ceilings(100));

  const totalsForB = await store.totals(tenantB, "company", "company");
  assert.equal(totalsForB.totalUsd, 0, "tenant B's session must not see tenant A's reserved total");
});
