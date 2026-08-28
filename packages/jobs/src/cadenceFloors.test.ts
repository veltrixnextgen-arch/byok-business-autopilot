import assert from "node:assert/strict";
import { test } from "node:test";
import { clampCadenceToFloor } from "./cadenceFloors.js";

test("a declared cadence at or slower than the floor is never clamped", () => {
  assert.deepEqual(clampCadenceToFloor("daily"), { cadence: "daily", clamped: false });
  assert.deepEqual(clampCadenceToFloor("weekly"), { cadence: "weekly", clamped: false });
  assert.deepEqual(clampCadenceToFloor("monthly"), { cadence: "monthly", clamped: false });
});

test("a declared cadence faster than the daily floor is clamped up to daily, with a reason", () => {
  const result = clampCadenceToFloor("hourly");
  assert.equal(result.cadence, "daily");
  assert.equal(result.clamped, true);
  assert.match(result.reason ?? "", /Runs daily\./);
});

test("15min is clamped up to daily too — the floor is uniform, no faster tier to name", () => {
  const result = clampCadenceToFloor("15min");
  assert.equal(result.cadence, "daily");
  assert.equal(result.clamped, true);
});

test("nightly ranks the same as daily for floor comparison — never clamped", () => {
  assert.deepEqual(clampCadenceToFloor("nightly"), { cadence: "nightly", clamped: false });
});
