import { randomUUID } from "node:crypto";

// The production version of the differentiation-test runner's resumable
// run-state.json fix (test/run-differentiation.ts): when a batch run gets
// interrupted mid-way — a provider billing failure, or the batch's own
// ceiling running out — completed work must be preserved and the rest
// resumable, not silently lost or requiring a full re-run (and re-spend).
export type ExhaustionReason = "provider-billing-failure" | "ceiling-exhausted";

export interface SerializedTask {
  id: string;
  [key: string]: unknown;
}

export interface PausedBatchState {
  id: string;
  pausedAt: string;
  reason: ExhaustionReason;
  completedTaskIds: string[];
  remainingTasks: SerializedTask[];
  context?: Record<string, unknown>;
}

export class UnknownPausedBatchError extends Error {}

export class BatchExhaustionManager {
  private readonly paused = new Map<string, PausedBatchState>();

  pause(input: {
    reason: ExhaustionReason;
    completedTaskIds: string[];
    remainingTasks: SerializedTask[];
    context?: Record<string, unknown>;
  }): PausedBatchState {
    const state: PausedBatchState = { id: randomUUID(), pausedAt: new Date().toISOString(), ...input };
    this.paused.set(state.id, state);
    return state;
  }

  get(id: string): PausedBatchState {
    const state = this.paused.get(id);
    if (!state) throw new UnknownPausedBatchError(`No paused batch "${id}".`);
    return state;
  }

  /** Returns the paused state for the caller to re-dispatch remainingTasks
   *  from. Does NOT clear it — call complete() once the caller has
   *  actually finished processing the rest, so a resume attempt that
   *  itself fails part-way can be resumed again from the same state. */
  resume(id: string): PausedBatchState {
    return this.get(id);
  }

  complete(id: string): void {
    if (!this.paused.has(id)) throw new UnknownPausedBatchError(`No paused batch "${id}".`);
    this.paused.delete(id);
  }

  list(): readonly PausedBatchState[] {
    return [...this.paused.values()];
  }
}

// Retry policy: budget-exhaustion failures are never auto-retried (spec).
// A transient failure (network blip, provider 5xx) is; a billing/ceiling
// failure means "spending more won't help" and must surface to a human or
// wait for the vault's/gate's own resume path, not a retry loop that keeps
// hitting the same wall.
export type FailureKind = "transient" | "budget-exhaustion" | "provider-billing";

export function isAutoRetryable(kind: FailureKind): boolean {
  return kind === "transient";
}
