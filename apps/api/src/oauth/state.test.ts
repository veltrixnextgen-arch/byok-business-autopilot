import { test } from "node:test";
import assert from "node:assert/strict";
import { createOAuthState, verifyOAuthState, InvalidOAuthStateError } from "./state.js";

const SECRET = "test-secret-at-least-this-long-0001";
const PAYLOAD = { tenantId: "tenant-a", subAgentId: "scheduling", capabilityScope: "google-calendar:events", service: "google-calendar" };

test("round-trips: a state created with a payload verifies back to the exact same payload", () => {
  const state = createOAuthState(SECRET, PAYLOAD);
  assert.deepEqual(verifyOAuthState(SECRET, state), PAYLOAD);
});

test("rejects a state signed with a different secret", () => {
  const state = createOAuthState("a-different-secret-0002", PAYLOAD);
  assert.throws(() => verifyOAuthState(SECRET, state), InvalidOAuthStateError);
});

test("rejects a tampered payload even if the signature format still parses", () => {
  const state = createOAuthState(SECRET, PAYLOAD);
  const [encoded, signature] = state.split(".");
  const tamperedPayload = { ...PAYLOAD, tenantId: "tenant-b" };
  const tamperedEncoded = Buffer.from(JSON.stringify({ ...tamperedPayload, nonce: "x", issuedAt: Date.now() }), "utf8").toString("base64url");
  assert.throws(() => verifyOAuthState(SECRET, `${tamperedEncoded}.${signature}`), InvalidOAuthStateError);
});

test("rejects a malformed state with no signature separator", () => {
  assert.throws(() => verifyOAuthState(SECRET, "not-a-real-state-token"), InvalidOAuthStateError);
});

test("rejects an expired state", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const state = createOAuthState(SECRET, PAYLOAD);
  t.mock.timers.tick(11 * 60_000); // past the 10-minute TTL
  assert.throws(() => verifyOAuthState(SECRET, state), InvalidOAuthStateError);
});

test("two states for the same payload are never identical (real nonce, not deterministic)", () => {
  const a = createOAuthState(SECRET, PAYLOAD);
  const b = createOAuthState(SECRET, PAYLOAD);
  assert.notEqual(a, b);
});
