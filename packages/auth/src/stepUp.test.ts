import assert from "node:assert/strict";
import { test } from "node:test";
import { STEP_UP_OPERATIONS, StepUpRequiredError, assertStepUp, isStepUpOperation } from "./stepUp.js";

test("all four T6 step-up operations are present", () => {
  assert.deepEqual([...STEP_UP_OPERATIONS].sort(), [
    "autonomy_grant",
    "ceiling_change",
    "deploy_approval",
    "key_ops",
  ]);
});

test("isStepUpOperation narrows correctly", () => {
  assert.equal(isStepUpOperation("key_ops"), true);
  assert.equal(isStepUpOperation("read_dashboard"), false);
});

test("throws when no assertion is present", () => {
  assert.throws(() => assertStepUp("key_ops", undefined), StepUpRequiredError);
});

test("throws when the assertion is older than the freshness window", () => {
  const now = new Date("2026-08-01T12:10:00Z");
  const verifiedAt = new Date("2026-08-01T12:00:00Z"); // 10 minutes ago
  assert.throws(
    () => assertStepUp("ceiling_change", { verifiedAt, method: "totp" }, now, 5 * 60 * 1000),
    StepUpRequiredError,
  );
});

test("throws when the assertion is in the future (clock skew / forged timestamp)", () => {
  const now = new Date("2026-08-01T12:00:00Z");
  const verifiedAt = new Date("2026-08-01T12:05:00Z");
  assert.throws(() => assertStepUp("autonomy_grant", { verifiedAt, method: "totp" }, now), StepUpRequiredError);
});

test("passes for a fresh assertion within the window", () => {
  const now = new Date("2026-08-01T12:04:00Z");
  const verifiedAt = new Date("2026-08-01T12:00:00Z");
  assert.doesNotThrow(() => assertStepUp("deploy_approval", { verifiedAt, method: "webauthn" }, now, 5 * 60 * 1000));
});

test("error message names the operation and reason", () => {
  try {
    assertStepUp("key_ops", undefined);
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof StepUpRequiredError);
    assert.equal(err.operation, "key_ops");
    assert.match(err.message, /key_ops/);
  }
});
