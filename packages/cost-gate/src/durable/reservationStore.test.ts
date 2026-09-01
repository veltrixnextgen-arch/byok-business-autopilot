import assert from "node:assert/strict";
import { test } from "node:test";
import type { CeilingConfig } from "../ceilings.js";
import { companyScopeKey, InMemoryDurableReservationStore, UnknownOrResolvedReservationError } from "./reservationStore.js";

const TENANT = "t1";

function ceilings(overrides: Partial<CeilingConfig> = {}): CeilingConfig {
  return { companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {}, ...overrides };
}

test("companyScopeKey: two days in the same UTC month produce the same key — the counter is shared all month", () => {
  assert.equal(companyScopeKey("2026-08-01"), companyScopeKey("2026-08-31"));
});

test("companyScopeKey: crossing a month boundary produces a genuinely different key — this IS the reset, no cron job", () => {
  assert.notEqual(companyScopeKey("2026-08-31"), companyScopeKey("2026-09-01"));
});

test("companyScopeKey: a tenant's cumulative-forever total from before this fix is a dead, orphaned key, not a header start", () => {
  // The bug this fix closes: scope_key was the literal "company" for every
  // tenant, forever. Proving the new key is never that literal string is
  // what proves a tenant who'd hit the old, never-resetting ceiling starts
  // this month with a genuinely fresh $0 counter, not still summing
  // against whatever it accumulated before this shipped.
  assert.notEqual(companyScopeKey(), "company");
});

test("reserveAtomic succeeds and returns a reservation id when within every ceiling", async () => {
  const store = new InMemoryDurableReservationStore();
  const result = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "cfo", taskType: "invoicing", amountUsd: 10 },
    ceilings(),
  );
  assert.equal(result.withinCeiling, true);
  assert.ok(result.reservationId);
});

test("checks company, then role, then task-type, in that order", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({ companyMonthlyUsd: 5, perRoleUsd: { cfo: 100 }, perTaskTypeUsd: { invoicing: 100 } });

  const result = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "cfo", taskType: "invoicing", amountUsd: 10 },
    config,
  );
  assert.equal(result.withinCeiling, false);
  assert.equal(result.exceededLevel, "company");
});

test("reservations already reserved count against the ceiling for the next evaluation", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({ companyMonthlyUsd: 15 });

  const first = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "cfo", taskType: "invoicing", amountUsd: 10 },
    config,
  );
  assert.equal(first.withinCeiling, true);

  const second = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-2", roleId: "cfo", taskType: "invoicing", amountUsd: 10 },
    config,
  );
  assert.equal(second.withinCeiling, false, "the first reservation's amount must already count against the ceiling");
});

test("settle adjusts the total by the delta between estimated and actual cost", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({ companyMonthlyUsd: 20 });

  const reserved = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "cfo", taskType: "invoicing", amountUsd: 10 },
    config,
  );
  await store.settle(TENANT, reserved.reservationId!, 4); // actual cost much lower than the upper-bound estimate

  const totals = await store.totals(TENANT, "company", companyScopeKey());
  assert.equal(totals.totalUsd, 4);

  // A second reservation should now see the freed-up budget.
  const second = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-2", roleId: "cfo", taskType: "invoicing", amountUsd: 15 },
    config,
  );
  assert.equal(second.withinCeiling, true);
});

test("release frees the reserved amount back up entirely", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({ companyMonthlyUsd: 10 });

  const reserved = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "cfo", taskType: "invoicing", amountUsd: 10 },
    config,
  );
  await store.release(TENANT, reserved.reservationId!);

  const totals = await store.totals(TENANT, "company", companyScopeKey());
  assert.equal(totals.totalUsd, 0);
});

test("settling or releasing an unknown or already-resolved reservation throws", async () => {
  const store = new InMemoryDurableReservationStore();
  await assert.rejects(() => store.settle(TENANT, "not-a-real-id", 5), UnknownOrResolvedReservationError);
  await assert.rejects(() => store.release(TENANT, "not-a-real-id"), UnknownOrResolvedReservationError);
});

test("task-type-day ceiling rejects a reservation that would exceed the daily per-agent cap", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({ companyMonthlyUsd: 1000, perTaskTypePerDayUsd: { "agent-priya": 5 } });

  const first = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "cfo", taskType: "agent-priya", amountUsd: 4 },
    config,
  );
  assert.equal(first.withinCeiling, true);

  const second = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-2", roleId: "cfo", taskType: "agent-priya", amountUsd: 2 },
    config,
  );
  assert.equal(second.withinCeiling, false, "the first reservation already spent $4 of today's $5 cap for this agent");
  assert.equal(second.exceededLevel, "task-type-day");
});

test("task-type-day ceiling doesn't leak across different agents (taskType)", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({ companyMonthlyUsd: 1000, perTaskTypePerDayUsd: { "agent-priya": 5 } });

  const priya = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "cfo", taskType: "agent-priya", amountUsd: 4 },
    config,
  );
  assert.equal(priya.withinCeiling, true);

  const sam = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-2", roleId: "cfo", taskType: "agent-sam", amountUsd: 4 },
    config,
  );
  assert.equal(sam.withinCeiling, true, "a different agent's own daily cap must be untouched by agent-priya's spend");
});

test("settling a task-type-day reservation for less than reserved frees the difference back up", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({ companyMonthlyUsd: 1000, perTaskTypePerDayUsd: { "agent-priya": 5 } });

  const reserved = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "cfo", taskType: "agent-priya", amountUsd: 4 },
    config,
  );
  await store.settle(TENANT, reserved.reservationId!, 1); // actual cost far under the upper-bound estimate

  const second = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-2", roleId: "cfo", taskType: "agent-priya", amountUsd: 3 },
    config,
  );
  assert.equal(second.withinCeiling, true, "settling for $1 instead of $4 must free the other $3 of today's cap");
});

test("releasing a task-type-day reservation frees the full amount back up", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({ companyMonthlyUsd: 1000, perTaskTypePerDayUsd: { "agent-priya": 5 } });

  const reserved = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "cfo", taskType: "agent-priya", amountUsd: 5 },
    config,
  );
  await store.release(TENANT, reserved.reservationId!);

  const second = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-2", roleId: "cfo", taskType: "agent-priya", amountUsd: 5 },
    config,
  );
  assert.equal(second.withinCeiling, true);
});

test("perTaskTypePerDayUsd left unset means no day-level cap, matching the other levels' absent-key default", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({ companyMonthlyUsd: 1000 });

  const result = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "cfo", taskType: "agent-priya", amountUsd: 999 },
    config,
  );
  assert.equal(result.withinCeiling, true);
});

test("a taskType with no entry in perTaskTypePerDayUsd falls back to perTaskTypePerDayDefaultUsd", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({
    companyMonthlyUsd: 1000,
    perTaskTypePerDayUsd: { "agent-priya": 50 }, // a real per-agent entry, but for a different agent
    perTaskTypePerDayDefaultUsd: 5,
  });

  const first = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "onboarding", taskType: "website-summary", amountUsd: 4 },
    config,
  );
  assert.equal(first.withinCeiling, true);

  const second = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-2", roleId: "onboarding", taskType: "website-summary", amountUsd: 2 },
    config,
  );
  assert.equal(second.withinCeiling, false, "website-summary has no per-agent entry, so it's capped by the flat $5 default");
  assert.equal(second.exceededLevel, "task-type-day");
});

test("a per-agent entry in perTaskTypePerDayUsd wins over perTaskTypePerDayDefaultUsd for that taskType", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({
    companyMonthlyUsd: 1000,
    perTaskTypePerDayUsd: { "agent-priya": 50 },
    perTaskTypePerDayDefaultUsd: 5,
  });

  const result = await store.reserveAtomic(
    { tenantId: TENANT, taskId: "task-1", roleId: "cfo", taskType: "agent-priya", amountUsd: 20 },
    config,
  );
  assert.equal(result.withinCeiling, true, "agent-priya's own $50 entry applies, not the $5 flat default");
});

test("tenants are fully isolated from each other's ceilings and totals", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({ companyMonthlyUsd: 10 });

  const t1 = await store.reserveAtomic({ tenantId: "t1", taskId: "task-1", roleId: "cfo", taskType: "x", amountUsd: 10 }, config);
  assert.equal(t1.withinCeiling, true);

  const t2 = await store.reserveAtomic({ tenantId: "t2", taskId: "task-1", roleId: "cfo", taskType: "x", amountUsd: 10 }, config);
  assert.equal(t2.withinCeiling, true, "tenant t2 must have its own independent ceiling budget");
});
