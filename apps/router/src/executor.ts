import type { RouterTask } from "./types.js";

export type ExecutionOutcome = { result: string } | { error: string };

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
