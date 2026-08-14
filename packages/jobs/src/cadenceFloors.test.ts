import assert from "node:assert/strict";
import { test } from "node:test";
import { clampCadenceToTierFloor } from "./cadenceFloors.js";

test("a declared cadence at or slower than the tier floor is never clamped", () => {
  assert.deepEqual(clampCadenceToTierFloor("daily", "solo"), { cadence: "daily", clamped: false });
  assert.deepEqual(clampCadenceToTierFloor("weekly", "solo"), { cadence: "weekly", clamped: false });
  assert.deepEqual(clampCadenceToTierFloor("hourly", "company"), { cadence: "hourly", clamped: false });
  assert.deepEqual(clampCadenceToTierFloor("15min", "scale"), { cadence: "15min", clamped: false });
});

test("a declared cadence faster than Solo's daily floor is clamped up to daily, with a reason", () => {
  const result = clampCadenceToTierFloor("hourly", "solo");
  assert.equal(result.cadence, "daily");
  assert.equal(result.clamped, true);
  assert.match(result.reason ?? "", /Runs daily on Solo — hourly available on Company\./);
});

test("a declared cadence faster than Company's hourly floor is clamped up to hourly", () => {
  const result = clampCadenceToTierFloor("15min", "company");
  assert.equal(result.cadence, "hourly");
  assert.equal(result.clamped, true);
  assert.match(result.reason ?? "", /Runs hourly on Company — 15min available on Scale\./);
});

test("Scale has no floor above 15min — nothing is ever clamped on it", () => {
  assert.deepEqual(clampCadenceToTierFloor("15min", "scale"), { cadence: "15min", clamped: false });
});

test("nightly ranks the same as daily for floor comparison — solo allows both", () => {
  assert.deepEqual(clampCadenceToTierFloor("nightly", "solo"), { cadence: "nightly", clamped: false });
});

test("nightly is clamped on tiers whose floor is faster than daily (nothing is faster today, so never clamped)", () => {
  assert.deepEqual(clampCadenceToTierFloor("nightly", "company"), { cadence: "nightly", clamped: false });
  assert.deepEqual(clampCadenceToTierFloor("nightly", "scale"), { cadence: "nightly", clamped: false });
});
