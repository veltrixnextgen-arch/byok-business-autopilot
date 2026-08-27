import type { EffectDescriptor } from "@byok/approval-queue";

// R5 (docs/architecture/automation-runtime-plan.md §4): "Single tasks
// aren't enough: detect overdue invoice → draft reminder → approval gate
// → send → log is five steps." A chain is that sequence — structured
// state travelling with the task, never a second memory/context channel
// for an agent to read (security-architecture.md's memory-isolation
// rule holds exactly the same way it does for a single task).
export type ChainStepStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export interface ChainStep {
  id: string;
  agentId: string;
  subAgentId: string;
  /** Plain-language description of this step, shown to the user — same
   *  "Fix this"/plain-reasoning design law every other agent-facing
   *  surface in this codebase follows. */
  description: string;
  /** Present only when this step, if it runs, would actually DO
   *  something in the world — mirrors ProposedAction.effect exactly
   *  (undefined = pure draft/internal step, never gates on approval for
   *  this reason alone; a step can still require approval without an
   *  effect, e.g. "review the draft before the chain continues"). */
  effect?: EffectDescriptor;
  requiresApproval: boolean;
  status: ChainStepStatus;
  /** Set once this step's own task/action resolves — never raw agent
   *  output, always the same short summary shape ProposedAction.summary
   *  already uses. */
  resultSummary?: string;
  /** Links back to ApprovalQueue's ProposedAction.id when this step
   *  gated on approval and is currently waiting — the join key the
   *  wiring layer (a later PR, not this one) uses to know which chain
   *  to advance when ApprovalQueue.onEvent fires a resolution. */
  approvalActionId?: string;
}

export type ChainStatus =
  | "running"
  | "awaiting_approval"
  | "completed"
  | "aborted_stale"
  | "expired"
  | "failed";

export interface Chain {
  id: string;
  tenantId: string;
  /** Plain-language description of what started this chain (e.g. "Overdue
   *  invoice detected for Acme Corp") — shown in the UI, and what "does
   *  the triggering condition still hold" staleness re-checks are
   *  actually re-checking the truth of. */
  triggerSummary: string;
  steps: readonly ChainStep[];
  /** Index into `steps` of the step currently running or awaiting
   *  approval. Equal to `steps.length` once the chain is `completed`. */
  currentStepIndex: number;
  status: ChainStatus;
  createdAt: string;
  updatedAt: string;
  /** Default 7 days from creation (automation-runtime-plan.md §4) — a
   *  chain paused at an approval gate past this age expires with a
   *  notification rather than resuming on a condition nobody has
   *  re-confirmed in a week. */
  expiresAt: string;
}

export class UnknownChainStepError extends Error {}
export class ChainNotRunnableError extends Error {}
