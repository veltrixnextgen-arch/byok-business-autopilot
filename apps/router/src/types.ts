// The task-object: the unit that's handed off between sub-agents. Distinct
// from @open-multi-agent/core's own Task type (packages/) — this is OUR
// domain object, tagged/deduped/ledgered by the router BEFORE it's ever
// translated into a library Task and executed. ADR-001: the router only
// ever dispatches at this granularity, one sub-agent's task at a time.
export type RouterTaskStatus = "pending" | "in_progress" | "completed" | "failed";

export interface RouterTask {
  id: string;
  subAgentId: string;
  teamId: string;
  title: string;
  payload: string;
  tags: string[];
  /** Idempotency key. Resubmitting the same key returns the existing task
   *  instead of re-executing — this is the dedup mechanism. */
  dedupKey: string;
  /** Links back to packages/agents/extraction's OrgChartTask.id, when this
   *  router task originated from an extracted org chart. */
  sourceOrgChartTaskId?: string;
  createdAt: string;
  updatedAt: string;
  status: RouterTaskStatus;
  result?: string;
  error?: string;
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
}

export interface LedgerEntry {
  taskId: string;
  subAgentId: string;
  status: RouterTaskStatus;
  at: string;
  note?: string;
}
