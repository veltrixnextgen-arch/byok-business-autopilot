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

// R2 (ADR-024): which tier of the prompt cascade this task's agent belongs
// to. Drives two things in router.ts: which approval-queue pathway a
// successful run's output goes through (submitProposedAction for
// "role-lead"/"sub-agent", submitRecommendation for "ceo" — T10/ADR-004),
// and — for "ceo" specifically — a hard, structural refusal to ever attach
// an effect, independent of what the caller requested. Defaults to
// "sub-agent" when omitted, matching every task submitted before this field
// existed.
export type PromptTier = "ceo" | "role-lead" | "sub-agent";

export interface RouterTask {
  id: string;
  tenantId: string;
  subAgentId: string;
  teamId: string;
  title: string;
  payload: string;
  tags: string[];
  /** The immutable system prompt this dispatch composes from the tenant's
   *  active Charter cascade (security-architecture.md §5.1's "immutable
   *  role prompts... composed by the router per dispatch") — undefined for
   *  callers that don't participate in the cascade yet (extraction's
   *  platform-paid batch never goes through submitTask at all, per
   *  ADR-014, so this is exclusively a BYOK/cascade-driven-task concern). */
  systemPrompt?: string;
  promptTier: PromptTier;
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
  /** Hands services this run needed but weren't connected (issue #22) —
   *  present only when the executor's outcome carried them. Their absence
   *  forced `effect` to be dropped when this task's action was submitted
   *  to the approval queue, whatever the caller originally requested. */
  missingHands?: string[];
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
   *  actually dispatches anything (approval-queue's own core model).
   *  IGNORED entirely when promptTier is "ceo" — router.ts drops it before
   *  the executor ever runs, never merely at the approval-queue boundary
   *  (T10/ADR-004: no dispatch pathway exists for the CEO agent, full stop). */
  effect?: { kind: EffectKind; description: string; detail?: Record<string, unknown> };
  /** The composed system prompt for this dispatch (R2/ADR-024) — see
   *  RouterTask.systemPrompt. */
  systemPrompt?: string;
  /** Defaults to "sub-agent" — every caller before R2 is implicitly this
   *  tier. See RouterTask.promptTier / PromptTier for what each tier does
   *  differently in router.ts. */
  promptTier?: PromptTier;
}

export interface LedgerEntry {
  taskId: string;
  subAgentId: string;
  status: RouterTaskStatus;
  at: string;
  note?: string;
}
