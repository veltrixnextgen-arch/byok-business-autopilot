import { OpenMultiAgent } from "@open-multi-agent/core";
import type { BrainKeyProvider, RequesterIdentity } from "@byok/vault";
import type { AgentExecutor, ExecutionOutcome } from "./executor.js";
import type { RouterTask } from "./types.js";

// Real execution adapter. The router never holds a Brain's API key itself
// (ADR-002: Brains are per-role, vault-managed) — it pulls a short-lived
// SecretHandle from the vault for this task's role (task.teamId — Brains
// are chosen per role/team-lead, and the team inherits its lead's choice,
// per roles-and-api-key-guide.md Screen 5) and only holds the plaintext
// inside SecretHandle.use(), for the duration of this one call.
//
// `vault` is typed as the narrow BrainKeyProvider interface, not the full
// Vault class, so tests can pass a fake object implementing just
// decryptBrainKey() without pulling in real KMS/crypto machinery.
//
// `orchestratorFactory` defaults to constructing a real OpenMultiAgent, but
// is injectable so tests can verify the full pull-key -> run -> zero flow
// without a live LLM call or network access.
export type OrchestratorFactory = (apiKey: string, defaultModel: string) => Pick<OpenMultiAgent, "runAgent">;

const defaultOrchestratorFactory: OrchestratorFactory = (apiKey, defaultModel) =>
  new OpenMultiAgent({ defaultApiKey: apiKey, defaultModel });

export class OpenMultiAgentExecutor implements AgentExecutor {
  constructor(
    private readonly vault: BrainKeyProvider,
    private readonly requester: RequesterIdentity,
    private readonly model: string,
    private readonly orchestratorFactory: OrchestratorFactory = defaultOrchestratorFactory,
  ) {}

  async execute(task: RouterTask): Promise<ExecutionOutcome> {
    let handle;
    try {
      handle = await this.vault.decryptBrainKey(task.teamId, this.requester);
    } catch (err) {
      return { error: `Brain key unavailable for role "${task.teamId}": ${(err as Error).message}` };
    }

    return handle.use(async (apiKeyBuffer) => {
      try {
        const orchestrator = this.orchestratorFactory(apiKeyBuffer.toString("utf8"), this.model);
        const result = await orchestrator.runAgent({ name: task.subAgentId, model: this.model }, task.payload);
        return { result: result.output };
      } catch (err) {
        return { error: (err as Error).message };
      }
    });
  }
}
