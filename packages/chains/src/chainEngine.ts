import { ChainNotRunnableError, UnknownChainStepError, type Chain, type ChainStep } from "./types.js";

const TERMINAL_STATUSES: readonly Chain["status"][] = ["completed", "aborted_stale", "expired", "failed"];

function isTerminal(chain: Chain): boolean {
  return TERMINAL_STATUSES.includes(chain.status);
}

/** Default staleness window (automation-runtime-plan.md §4: "Chains
 *  older than a configurable window (default 7 days) expire with a
 *  notification"). A caller-supplied `now` (never `new Date()` read
 *  internally) keeps every function here pure and exhaustively testable
 *  — same discipline as packages/cost-gate's evaluateGateVerdict. */
export const DEFAULT_CHAIN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export function newChainExpiryAt(createdAt: Date, expiryMs: number = DEFAULT_CHAIN_EXPIRY_MS): string {
  return new Date(createdAt.getTime() + expiryMs).toISOString();
}

/** The step a caller should actually execute next — null when the chain
 *  has nothing left to run (already terminal, or already sitting at an
 *  approval gate waiting on a human, not the engine). */
export function nextRunnableStep(chain: Chain): ChainStep | null {
  if (isTerminal(chain) || chain.status === "awaiting_approval") return null;
  return chain.steps[chain.currentStepIndex] ?? null;
}

function findStep(chain: Chain, stepId: string): ChainStep {
  const step = chain.steps.find((s) => s.id === stepId);
  if (!step) throw new UnknownChainStepError(`Chain "${chain.id}" has no step "${stepId}".`);
  return step;
}

function withStep(chain: Chain, stepId: string, patch: Partial<ChainStep>): readonly ChainStep[] {
  return chain.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s));
}

/**
 * A step finished running (outside this package — the actual dispatch
 * lives in apps/api/Router, a later PR). Three outcomes:
 *   - failed: the chain fails outright. A failed step never partially
 *     completes a chain; there's no meaningful "skip and continue" for a
 *     sequence where later steps assume earlier ones succeeded.
 *   - succeeded, requiresApproval: the chain pauses — `advanceChain` does
 *     NOT move past an approval gate itself; `resolveApprovalGate` (below)
 *     is the only path forward from `awaiting_approval`, so a verdict is
 *     never accidentally skipped by calling the wrong function.
 *   - succeeded, no approval needed: moves straight to the next step, or
 *     to `completed` if this was the last one.
 */
export function advanceChain(
  chain: Chain,
  outcome: { stepId: string; now: Date; success: boolean; resultSummary?: string },
): Chain {
  if (isTerminal(chain)) {
    throw new ChainNotRunnableError(`Chain "${chain.id}" is already terminal ("${chain.status}") — cannot advance.`);
  }
  const step = findStep(chain, outcome.stepId);
  const nowIso = outcome.now.toISOString();

  if (!outcome.success) {
    return {
      ...chain,
      steps: withStep(chain, outcome.stepId, { status: "failed", resultSummary: outcome.resultSummary }),
      status: "failed",
      updatedAt: nowIso,
    };
  }

  const steps = withStep(chain, outcome.stepId, { status: "completed", resultSummary: outcome.resultSummary });
  const isLastStep = chain.currentStepIndex >= chain.steps.length - 1;

  if (step.requiresApproval) {
    return { ...chain, steps, status: "awaiting_approval", updatedAt: nowIso };
  }
  if (isLastStep) {
    return { ...chain, steps, status: "completed", currentStepIndex: chain.steps.length, updatedAt: nowIso };
  }
  return { ...chain, steps, currentStepIndex: chain.currentStepIndex + 1, updatedAt: nowIso };
}

/**
 * The approval-gate resolution (automation-runtime-plan.md §4's "hard
 * question, answered explicitly"): a chain paused at a gate resumes on
 * approval, but ONLY after re-checking the triggering condition still
 * holds. `conditionStillValid` is a caller-supplied fact (this package
 * has no way to know "is the invoice still overdue" — that's domain
 * logic the wiring layer owns), not a callback invoked here, so this
 * function stays pure and synchronous like every other one in this file.
 * A reject verdict fails the chain outright, same reasoning as a failed
 * step above — there's no partial-chain state worth preserving.
 */
export function resolveApprovalGate(
  chain: Chain,
  input: { verdict: "approve" | "reject"; now: Date; conditionStillValid: boolean },
): Chain {
  if (chain.status !== "awaiting_approval") {
    throw new ChainNotRunnableError(`Chain "${chain.id}" is not awaiting approval (status: "${chain.status}").`);
  }
  const nowIso = input.now.toISOString();

  if (!input.conditionStillValid) {
    return { ...chain, status: "aborted_stale", updatedAt: nowIso };
  }
  if (input.verdict === "reject") {
    return { ...chain, status: "failed", updatedAt: nowIso };
  }

  const isLastStep = chain.currentStepIndex >= chain.steps.length - 1;
  return isLastStep
    ? { ...chain, status: "completed", currentStepIndex: chain.steps.length, updatedAt: nowIso }
    : { ...chain, status: "running", currentStepIndex: chain.currentStepIndex + 1, updatedAt: nowIso };
}

export function isChainExpired(chain: Chain, now: Date): boolean {
  return !isTerminal(chain) && now.getTime() > new Date(chain.expiresAt).getTime();
}

/** Called by a sweep (a later PR — the actual cron/worker that finds
 *  every non-terminal chain past its expiresAt and calls this) — a
 *  no-op (returns the same chain) when the chain isn't actually expired,
 *  so a caller can run this unconditionally over a batch without
 *  pre-filtering first. */
export function expireChain(chain: Chain, now: Date): Chain {
  if (!isChainExpired(chain, now)) return chain;
  return { ...chain, status: "expired", updatedAt: now.toISOString() };
}
