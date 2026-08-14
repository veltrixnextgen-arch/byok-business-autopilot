import { OpenMultiAgent } from "@open-multi-agent/core";
import type { BrainKeyProvider, HandsKeyProvider, RequesterIdentity } from "@byok/vault";
import type { AgentExecutor, ExecutionOutcome } from "./executor.js";
import { createHandsTool, type HandsToolSpec } from "./handsTool.js";
import type { RouterTask } from "./types.js";

// Real execution adapter. The router never holds a Brain's API key itself
// (ADR-002: Brains are per-tenant, per-role, vault-managed) — it pulls a
// short-lived SecretHandle from the vault for this task's tenant + role
// (task.tenantId + task.teamId — Brains are chosen per role/team-lead, and
// the team inherits its lead's choice, per roles-and-api-key-guide.md
// Screen 5) and only holds the plaintext inside SecretHandle.use(), for the
// duration of this one call. Both tenantId AND teamId are required: role
// ids like "cfo" are short, human-chosen slugs shared across every
// tenant's org chart, not globally unique — Vault's own per-tenant Map is
// what actually prevents one tenant's "cfo" key from colliding with
// another's, but only if every caller passes tenantId through, this one
// included.
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
// scope-binding enforced at decrypt time — see handsTool.ts). A second
// filter (issue #22, "just-in-time Hands granting") drops any spec whose
// key isn't actually connected for THIS tenant yet — the LLM never even
// sees a tool it can't use, and the run is flagged via `missingHands` on
// the outcome so the router can downgrade the result to a draft (never
// dispatch an effect for a capability that was never actually available).
// `handsVault` is optional: omit it (or pass an empty `handsTools`) to get
// the previous plain-text-only behavior unchanged — existing callers/tests
// are unaffected.
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
      handle = await this.vault.decryptBrainKey(task.tenantId, task.teamId, this.requester);
    } catch (err) {
      return { error: `Brain key unavailable for role "${task.teamId}": ${(err as Error).message}` };
    }

    // Populated two ways: the pre-flight filter below (no key stored at
    // all, before the LLM ever sees the tool) AND createHandsTool's
    // onLiveFailure callback (a key WAS connected at pre-flight but the
    // actual decrypt/refresh call during the run still failed — PR 2A's
    // verified gap, see handsTool.ts's comment on createHandsTool). Either
    // source lands here, and router.ts's existing
    // `effect: task.missingHands ? undefined : input.effect` treats them
    // identically — one required change, not two.
    const missingHands: string[] = [];
    const customTools =
      this.handsVault === undefined
        ? []
        : this.handsTools
            .filter((spec) => spec.subAgentId === task.subAgentId)
            .filter((spec) => {
              const connected = this.handsVault!.resolveHandsKeyId(task.tenantId, spec.subAgentId, spec.capabilityScope) !== null;
              if (!connected) missingHands.push(spec.service);
              return connected;
            })
            .map((spec) =>
              createHandsTool(spec, this.handsVault!, this.requester, task.tenantId, (service) => missingHands.push(service)),
            );

    return handle.use(async (apiKeyBuffer) => {
      try {
        const orchestrator = this.orchestratorFactory(apiKeyBuffer.toString("utf8"), this.model);
        // R2/ADR-024: the composed cascade prompt, when this dispatch has
        // one — security-architecture.md §5.1's "immutable role prompts...
        // composed by the router per dispatch". Omitted entirely (not an
        // empty string) when task.systemPrompt is unset, matching
        // customTools's existing "only include the key if there's a real
        // value" pattern just below.
        const result = await orchestrator.runAgent(
          {
            name: task.subAgentId,
            model: this.model,
            ...(task.systemPrompt ? { systemPrompt: task.systemPrompt } : {}),
            ...(customTools.length > 0 ? { customTools } : {}),
          },
          task.payload,
        );
        const uniqueMissingHands = [...new Set(missingHands)];
        return { result: result.output, ...(uniqueMissingHands.length > 0 ? { missingHands: uniqueMissingHands } : {}) };
      } catch (err) {
        return { error: (err as Error).message };
      }
    });
  }
}
