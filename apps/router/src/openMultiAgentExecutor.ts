import type { OpenMultiAgent } from "@open-multi-agent/core";
import type { AgentExecutor, ExecutionOutcome } from "./executor.js";
import type { RouterTask } from "./types.js";

// Real execution adapter. The router never holds a Brain's API key itself
// (ADR-002: Brains are per-role, vault-managed, collected from the user) —
// the caller constructs the OpenMultiAgent orchestrator with whatever
// credential/model the vault resolved for this sub-agent's role, and hands
// it to this executor. This class only knows how to translate a RouterTask
// into a single `runAgent` call and shape the result back.
export class OpenMultiAgentExecutor implements AgentExecutor {
  constructor(
    private readonly orchestrator: OpenMultiAgent,
    private readonly model: string,
  ) {}

  async execute(task: RouterTask): Promise<ExecutionOutcome> {
    try {
      const result = await this.orchestrator.runAgent({ name: task.subAgentId, model: this.model }, task.payload);
      return { result: result.output };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }
}
