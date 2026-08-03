import type { EffectKind } from "@byok/approval-queue";

// The task-object: the unit that's handed off between sub-agents. Distinct
// from @open-multi-agent/core's own Task type (packages/) — this is OUR
// domain object, tagged/deduped/ledgered by the router BEFORE it's ever
// translated into a library Task and executed. ADR-001: the router only
// ever dispatches at this granularity, one sub-agent's task at a time.
// "queued" and "skipped" are cost-gate verdicts (QUEUE/SKIP) — the task
// never reached the executor at all. "awaiting_review" means the executor
// DID run, but the approval queue is holding the result for a human (or
// spot-check) decision before it's visible as "done" (issue #9) — resolved
// later via a separate ApprovalQueue.resolve() call, not synchronously
// inside submitTask().
export type RouterTaskStatus = "pending" | "queued" | "in_progress" | "awaiting_review" | "completed" | "failed" | "skipped";

export interface RouterTask {
  id: string;
  tenantId: string;
  subAgentId: string;
  teamId: string;
  title: string;
  payload: string;
  tags: string[];
  /** The model to execute with. Set from RouterTaskInput.model, and
   *  possibly REWRITTEN by the cost gate on a DOWNGRADE verdict before
   *  the executor ever sees the task. */
  model?: string;
  /** Idempotency key. Resubmitting the same key returns the existing task
   *  instead of re-executing — this is the dedup mechanism. */
  dedupKey: string;
  /** Links back to @byok/contracts' Task.id, when this
   *  router task originated from an extracted org chart. */
  sourceOrgChartTaskId?: string;
  createdAt: string;
  updatedAt: string;
  status: RouterTaskStatus;
  result?: string;
  error?: string;
  /** Set once submitted to the approval queue — the id to resolve() against. */
  approvalActionId?: string;
}

export interface RouterTaskInput {
  subAgentId: string;
  teamId: string;
  title: string;
  payload: string;
  dedupKey: string;
  sourceOrgChartTaskId?: string;
  /** Caller-supplied tags, merged with auto-derived ones from TaggingHints. */
  tags?: string[];
  /** Requested starting model (from tier routing upstream). Required for
   *  the cost gate to evaluate this task — omit only when no CostGate is
   *  configured on this Router instance. */
  model?: string;
  outputClass?: "short-structured" | "prose";
  /** Whether this task type tolerates being queued for later/batch
   *  processing if it doesn't fit the budget right now. Defaults to true. */
  batchable?: boolean;
  /** Defaults to "default" — single-tenant callers can omit this. */
  tenantId?: string;
  /** Friendly agent name for the approval-queue card (Screen 7). Defaults
   *  to subAgentId when omitted (no naming UI exists yet). */
  agentName?: string;
  /** Present ONLY when this task type, if approved, would actually DO
   *  something in the world (send/post/pay/deploy) — omit for pure
   *  drafting/reasoning tasks. Drives whether the approval queue's verdict
   *  actually dispatches anything (approval-queue's own core model). */
  effect?: { kind: EffectKind; description: string; detail?: Record<string, unknown> };
}

export interface LedgerEntry {
  taskId: string;
  subAgentId: string;
  status: RouterTaskStatus;
  at: string;
  note?: string;
}
