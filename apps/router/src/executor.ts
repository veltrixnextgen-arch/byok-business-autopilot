import type { RouterTask } from "./types.js";

// costUsd is optional: not every executor can report an exact spend
// (OpenMultiAgentExecutor currently can't pull per-call cost out of the
// library's runAgent result). When absent, the router settles the cost
// gate's reservation using its estimate instead of leaving it unsettled.
export type ExecutionOutcome = { result: string; costUsd?: number } | { error: string };

// Execution is pluggable on purpose: the router's job (tag, dedup, ledger,
// hand off) is fully testable without a live LLM call. Production execution
// (OpenMultiAgentExecutor below) requires a configured Brain — that's the
// key vault + cost gate, both separate Phase A issues — so tests and local
// development use MockExecutor instead of needing real credentials.
export interface AgentExecutor {
  execute(task: RouterTask): Promise<ExecutionOutcome>;
}

export class MockExecutor implements AgentExecutor {
  async execute(task: RouterTask): Promise<ExecutionOutcome> {
    return { result: `[mock] ${task.subAgentId} completed "${task.title}"` };
  }
}
