import { OpenMultiAgent } from "@open-multi-agent/core";
import type { BrainKeyProvider, HandsKeyProvider, RequesterIdentity } from "@byok/vault";
import type { AgentExecutor, ExecutionOutcome } from "./executor.js";
import { createHandsTool, type HandsToolSpec } from "./handsTool.js";
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
// decryptBrainKey() without pulling in real KMS/crypto machinery. Same for
// `handsVault` (HandsKeyProvider) — both are this package's public seam
// into vault, per ADR-009's spirit even though that rule is written for
// apps/api specifically.
//
// `orchestratorFactory` defaults to constructing a real OpenMultiAgent, but
// is injectable so tests can verify the full pull-key -> run -> zero flow
// without a live LLM call or network access.
export type OrchestratorFactory = (apiKey: string, defaultModel: string) => Pick<OpenMultiAgent, "runAgent">;

const defaultOrchestratorFactory: OrchestratorFactory = (apiKey, defaultModel) =>
  new OpenMultiAgent({ defaultApiKey: apiKey, defaultModel });

// Tool-use capable: `handsTools` is the FULL catalog this executor instance
// was constructed with (every sub-agent's Hands, across every task it might
// see) — each `execute()` call filters it down to only the specs whose
// subAgentId matches THIS task before ever building the customTools list, so
// a hijacked agent can't even see another sub-agent's tool in its own
// tool-call list (defense in depth ahead of, not instead of, the AAD
// scope-binding enforced at decrypt time — see handsTool.ts). `handsVault`
// is optional: omit it (or pass an empty `handsTools`) to get the previous
// plain-text-only behavior unchanged — existing callers/tests are
// unaffected.
export class OpenMultiAgentExecutor implements AgentExecutor {
  constructor(
    private readonly vault: BrainKeyProvider,
    private readonly requester: RequesterIdentity,
    private readonly model: string,
    private readonly orchestratorFactory: OrchestratorFactory = defaultOrchestratorFactory,
    private readonly handsVault?: HandsKeyProvider,
    private readonly handsTools: readonly HandsToolSpec[] = [],
  ) {}

  async execute(task: RouterTask): Promise<ExecutionOutcome> {
    let handle;
    try {
      handle = await this.vault.decryptBrainKey(task.teamId, this.requester);
    } catch (err) {
      return { error: `Brain key unavailable for role "${task.teamId}": ${(err as Error).message}` };
    }

    const customTools =
      this.handsVault === undefined
        ? []
        : this.handsTools
            .filter((spec) => spec.subAgentId === task.subAgentId)
            .map((spec) => createHandsTool(spec, this.handsVault!, this.requester));

    return handle.use(async (apiKeyBuffer) => {
      try {
        const orchestrator = this.orchestratorFactory(apiKeyBuffer.toString("utf8"), this.model);
        const result = await orchestrator.runAgent(
          { name: task.subAgentId, model: this.model, ...(customTools.length > 0 ? { customTools } : {}) },
          task.payload,
        );
        return { result: result.output };
      } catch (err) {
        return { error: (err as Error).message };
      }
    });
  }
}
