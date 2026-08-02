import assert from "node:assert/strict";
import { test } from "node:test";
import type { CeilingConfig } from "../ceilings.js";
import { InMemoryDurableReservationStore, UnknownOrResolvedReservationError } from "./reservationStore.js";

const TENANT = "t1";

function ceilings(overrides: Partial<CeilingConfig> = {}): CeilingConfig {
  return { companyMonthlyUsd: 1000, perRoleUsd: {}, perTaskTypeUsd: {}, ...overrides };
}

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

  const totals = await store.totals(TENANT, "company", "company");
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

  const totals = await store.totals(TENANT, "company", "company");
  assert.equal(totals.totalUsd, 0);
});

test("settling or releasing an unknown or already-resolved reservation throws", async () => {
  const store = new InMemoryDurableReservationStore();
  await assert.rejects(() => store.settle(TENANT, "not-a-real-id", 5), UnknownOrResolvedReservationError);
  await assert.rejects(() => store.release(TENANT, "not-a-real-id"), UnknownOrResolvedReservationError);
});

test("tenants are fully isolated from each other's ceilings and totals", async () => {
  const store = new InMemoryDurableReservationStore();
  const config = ceilings({ companyMonthlyUsd: 10 });

  const t1 = await store.reserveAtomic({ tenantId: "t1", taskId: "task-1", roleId: "cfo", taskType: "x", amountUsd: 10 }, config);
  assert.equal(t1.withinCeiling, true);

  const t2 = await store.reserveAtomic({ tenantId: "t2", taskId: "task-1", roleId: "cfo", taskType: "x", amountUsd: 10 }, config);
  assert.equal(t2.withinCeiling, true, "tenant t2 must have its own independent ceiling budget");
});
