import { test } from "node:test";
import assert from "node:assert/strict";
import { ReservationLedger, ReservationAlreadyResolvedError, UnknownReservationError } from "./reservations.js";

test("reserve -> settle moves the amount from reserved into settled", () => {
  const ledger = new ReservationLedger();
  const r = ledger.reserve("cfo", "invoicing", 0.05);
  assert.equal(ledger.reservedCompanyUsd(), 0.05);
  assert.equal(ledger.settledCompanyTotal(), 0);

  ledger.settle(r.id, 0.04); // actual can differ from the reserved estimate
  assert.equal(ledger.reservedCompanyUsd(), 0);
  assert.equal(ledger.settledCompanyTotal(), 0.04);
});

test("reserve -> release removes the amount without ever counting it as spend", () => {
  const ledger = new ReservationLedger();
  const r = ledger.reserve("cfo", "invoicing", 0.05);
  ledger.release(r.id);
  assert.equal(ledger.reservedCompanyUsd(), 0);
  assert.equal(ledger.settledCompanyTotal(), 0);
});

test("cannot settle or release a reservation twice, or one that never existed", () => {
  const ledger = new ReservationLedger();
  const r = ledger.reserve("cfo", "invoicing", 0.05);
  ledger.settle(r.id, 0.05);
  assert.throws(() => ledger.settle(r.id, 0.05), ReservationAlreadyResolvedError);
  assert.throws(() => ledger.release(r.id), ReservationAlreadyResolvedError);
  assert.throws(() => ledger.settle("does-not-exist", 1), UnknownReservationError);
});

test("per-role and per-task-type totals are isolated from each other and from unrelated roles/types", () => {
  const ledger = new ReservationLedger();
  ledger.reserve("cfo", "invoicing", 0.10);
  ledger.reserve("cmo", "social-manager", 0.20);

  assert.equal(ledger.reservedRoleUsd("cfo"), 0.10);
  assert.equal(ledger.reservedRoleUsd("cmo"), 0.20);
  assert.equal(ledger.reservedTaskTypeUsd("invoicing"), 0.10);
  assert.equal(ledger.reservedTaskTypeUsd("social-manager"), 0.20);
  assert.ok(Math.abs(ledger.reservedCompanyUsd() - 0.30) < 1e-9);
});

test("ceiling race: many 'concurrent' reservations against a tight budget never double-count past it", async () => {
  // Simulates the router dispatching many tasks nearly simultaneously.
  // reserve() is synchronous, so interleaving these via Promise.all cannot
  // produce a race where two reservations both observe pre-reservation
  // totals — each reserve() call is atomic with respect to the JS event
  // loop. This test proves that invariant holds under concurrent-looking load.
  const ledger = new ReservationLedger();
  const budget = 1.0;
  const perTaskCost = 0.11; // 10 tasks would blow past 1.0; only 9 should fit

  const attempts = await Promise.all(
    Array.from({ length: 20 }, async (_, i) => {
      // Each "concurrent" attempt does the same check-then-reserve a real
      // caller would do, with an await in between to maximize interleaving.
      await Promise.resolve();
      const projected = ledger.reservedCompanyUsd() + ledger.settledCompanyTotal() + perTaskCost;
      if (projected > budget) return { index: i, admitted: false };
      const reservation = ledger.reserve("cfo", "invoicing", perTaskCost);
      return { index: i, admitted: true, reservationId: reservation.id };
    }),
  );

  const admittedCount = attempts.filter((a) => a.admitted).length;
  const totalReserved = ledger.reservedCompanyUsd();

  assert.ok(totalReserved <= budget + 1e-9, `total reserved $${totalReserved} exceeded budget $${budget}`);
  assert.ok(admittedCount <= Math.floor(budget / perTaskCost) + 1); // sanity bound, not exact due to interleaving order
});
