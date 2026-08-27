import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CHAIN_EXPIRY_MS,
  advanceChain,
  expireChain,
  isChainExpired,
  newChainExpiryAt,
  nextRunnableStep,
  resolveApprovalGate,
} from "./chainEngine.js";
import { ChainNotRunnableError, UnknownChainStepError, type Chain, type ChainStep } from "./types.js";

const NOW = new Date("2026-08-27T12:00:00.000Z");

function makeStep(overrides: Partial<ChainStep> & { id: string }): ChainStep {
  return {
    agentId: "agent-1",
    subAgentId: "invoicing",
    description: "a step",
    requiresApproval: false,
    status: "pending",
    ...overrides,
  };
}

function makeChain(overrides: Partial<Chain> = {}): Chain {
  return {
    id: "chain-1",
    tenantId: "tenant-1",
    triggerSummary: "Overdue invoice detected for Acme Corp",
    steps: [makeStep({ id: "step-1" }), makeStep({ id: "step-2" })],
    currentStepIndex: 0,
    status: "running",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: newChainExpiryAt(NOW),
    ...overrides,
  };
}

test("newChainExpiryAt defaults to 7 days from creation", () => {
  const expiresAt = newChainExpiryAt(NOW);
  assert.equal(new Date(expiresAt).getTime() - NOW.getTime(), DEFAULT_CHAIN_EXPIRY_MS);
  assert.equal(DEFAULT_CHAIN_EXPIRY_MS, 7 * 24 * 60 * 60 * 1000);
});

test("advanceChain: a successful step with no approval gate and more steps left moves to the next step, stays running", () => {
  const chain = makeChain();
  const result = advanceChain(chain, { stepId: "step-1", now: NOW, success: true, resultSummary: "logged" });

  assert.equal(result.status, "running");
  assert.equal(result.currentStepIndex, 1);
  assert.equal(result.steps[0].status, "completed");
  assert.equal(result.steps[0].resultSummary, "logged");
  assert.equal(result.steps[1].status, "pending");
});

test("advanceChain: a successful LAST step with no approval gate completes the chain", () => {
  const chain = makeChain({ currentStepIndex: 1 });
  const result = advanceChain(chain, { stepId: "step-2", now: NOW, success: true });

  assert.equal(result.status, "completed");
  assert.equal(result.currentStepIndex, 2);
  assert.equal(result.steps[1].status, "completed");
});

test("advanceChain: a successful step that requires approval pauses the chain, without moving currentStepIndex", () => {
  const chain = makeChain({ steps: [makeStep({ id: "step-1", requiresApproval: true }), makeStep({ id: "step-2" })] });
  const result = advanceChain(chain, { stepId: "step-1", now: NOW, success: true });

  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.currentStepIndex, 0, "resolveApprovalGate, not advanceChain, is what moves past a gate");
  assert.equal(result.steps[0].status, "completed");
});

test("advanceChain: a failed step fails the whole chain, never partially completes it", () => {
  const chain = makeChain();
  const result = advanceChain(chain, { stepId: "step-1", now: NOW, success: false, resultSummary: "provider error" });

  assert.equal(result.status, "failed");
  assert.equal(result.steps[0].status, "failed");
  assert.equal(result.steps[0].resultSummary, "provider error");
});

test("advanceChain: throws ChainNotRunnableError on an already-terminal chain", () => {
  const chain = makeChain({ status: "completed" });
  assert.throws(() => advanceChain(chain, { stepId: "step-1", now: NOW, success: true }), ChainNotRunnableError);
});

test("advanceChain: throws UnknownChainStepError for a step id that isn't in the chain", () => {
  const chain = makeChain();
  assert.throws(() => advanceChain(chain, { stepId: "not-a-real-step", now: NOW, success: true }), UnknownChainStepError);
});

test("resolveApprovalGate: approve with the condition still valid and more steps left resumes running, advances the index", () => {
  const chain = makeChain({ status: "awaiting_approval", currentStepIndex: 0 });
  const result = resolveApprovalGate(chain, { verdict: "approve", now: NOW, conditionStillValid: true });

  assert.equal(result.status, "running");
  assert.equal(result.currentStepIndex, 1);
});

test("resolveApprovalGate: approve on the LAST step completes the chain", () => {
  const chain = makeChain({ status: "awaiting_approval", currentStepIndex: 1 });
  const result = resolveApprovalGate(chain, { verdict: "approve", now: NOW, conditionStillValid: true });

  assert.equal(result.status, "completed");
  assert.equal(result.currentStepIndex, 2);
});

// automation-runtime-plan.md §4's own worked example: "If the triggering
// condition no longer holds when approval arrives (the invoice got
// paid), the chain aborts and tells the user why rather than sending a
// reminder for a settled invoice." Staleness wins regardless of verdict —
// even an APPROVE on a stale condition must not proceed.
test("resolveApprovalGate: a stale condition aborts the chain even when the verdict is approve", () => {
  const chain = makeChain({ status: "awaiting_approval" });
  const result = resolveApprovalGate(chain, { verdict: "approve", now: NOW, conditionStillValid: false });

  assert.equal(result.status, "aborted_stale");
});

test("resolveApprovalGate: reject fails the chain outright", () => {
  const chain = makeChain({ status: "awaiting_approval" });
  const result = resolveApprovalGate(chain, { verdict: "reject", now: NOW, conditionStillValid: true });

  assert.equal(result.status, "failed");
});

test("resolveApprovalGate: throws when the chain isn't actually awaiting approval", () => {
  const chain = makeChain({ status: "running" });
  assert.throws(
    () => resolveApprovalGate(chain, { verdict: "approve", now: NOW, conditionStillValid: true }),
    ChainNotRunnableError,
  );
});

test("isChainExpired / expireChain: expires a non-terminal chain past its expiresAt", () => {
  const chain = makeChain({ expiresAt: new Date(NOW.getTime() - 1000).toISOString() });
  assert.equal(isChainExpired(chain, NOW), true);

  const expired = expireChain(chain, NOW);
  assert.equal(expired.status, "expired");
});

test("isChainExpired / expireChain: a chain not yet past its expiresAt is untouched (no-op, same object shape)", () => {
  const chain = makeChain({ expiresAt: new Date(NOW.getTime() + 1000).toISOString() });
  assert.equal(isChainExpired(chain, NOW), false);
  assert.deepEqual(expireChain(chain, NOW), chain);
});

test("isChainExpired / expireChain: an already-terminal chain never re-expires, even past its expiresAt", () => {
  const chain = makeChain({ status: "completed", expiresAt: new Date(NOW.getTime() - 1000).toISOString() });
  assert.equal(isChainExpired(chain, NOW), false);
  assert.deepEqual(expireChain(chain, NOW), chain);
});

test("nextRunnableStep: returns the step at currentStepIndex for a running chain", () => {
  const chain = makeChain({ currentStepIndex: 1 });
  assert.equal(nextRunnableStep(chain)?.id, "step-2");
});

test("nextRunnableStep: returns null while awaiting approval — the engine never re-runs a gated step on its own", () => {
  const chain = makeChain({ status: "awaiting_approval" });
  assert.equal(nextRunnableStep(chain), null);
});

test("nextRunnableStep: returns null for every terminal status", () => {
  for (const status of ["completed", "aborted_stale", "expired", "failed"] as const) {
    assert.equal(nextRunnableStep(makeChain({ status })), null, `expected null for status "${status}"`);
  }
});
