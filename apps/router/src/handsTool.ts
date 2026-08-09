import { defineTool, type ToolDefinition } from "@open-multi-agent/core";
import type { HandsKeyProvider, RequesterIdentity } from "@byok/vault";

// A declarative Hands tool: what the LLM sees (name/description/inputSchema)
// plus which vault-stored Hands key backs it and the one sub-agent+scope
// claim it's allowed to make. `invoke` never receives a bare string — only
// the plaintext Buffer, for the span of a single call — and must not persist
// or log it itself (Section 3: "never written to disk, logs, traces, or
// model context").
export interface HandsToolSpec<TInput = Record<string, unknown>> {
  name: string;
  description: string;
  /** A zod schema, validated by @open-multi-agent/core's own `defineTool`.
   *  Typed `any` deliberately: OMA bundles its own private zod install
   *  (distinct from this workspace's hoisted one), so two "ZodSchema"
   *  types from different install locations are nominally incompatible
   *  even though structurally identical — this is a schema-library
   *  install quirk, not a real type-safety gap (runtime validation still
   *  happens; TInput is authored independently by each spec below). */
  inputSchema: any;
  keyId: string;
  subAgentId: string;
  capabilityScope: string;
  /** Marks a tool whose grant permits real side effects (send/post/pay) —
   *  forwarded to the OMA framework's own `consequential` flag. */
  consequential?: boolean;
  invoke: (apiKey: Buffer, input: TInput) => Promise<{ data: string; isError?: boolean }>;
}

// Wraps a HandsToolSpec into an OMA ToolDefinition that decrypts its key
// JUST IN TIME — only when the LLM actually calls this tool, never up front
// — matching Section 3's "granting is just-in-time (the agent asks when a
// task first needs it)". The claimed subAgentId+capabilityScope is fixed at
// spec-authoring time, not taken from the LLM's tool-call input, so a
// hijacked agent can't widen its own claim (T2/T8) even if it could see this
// tool's definition at all — and OpenMultiAgentExecutor never registers a
// spec whose subAgentId doesn't match the running task in the first place.
//
// Every vault failure (key not found/revoked, scope-binding mismatch,
// expired handle) is caught here and turned into a normal `isError` tool
// result instead of thrown — the LLM sees a clean failure and can react
// (retry, ask for help, give up), and the run never hangs or crashes on a
// key that was revoked mid-run.
export function createHandsTool(
  spec: HandsToolSpec,
  handsVault: HandsKeyProvider,
  requester: RequesterIdentity,
): ToolDefinition {
  return defineTool({
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    consequential: spec.consequential,
    execute: async (input) => {
      let handle;
      try {
        handle = await handsVault.decryptHandsKey(
          spec.keyId,
          { subAgentId: spec.subAgentId, capabilityScope: spec.capabilityScope },
          requester,
        );
      } catch (err) {
        return { data: `Hands key unavailable for "${spec.name}": ${(err as Error).message}`, isError: true };
      }

      return handle.use(async (apiKeyBuffer) => {
        try {
          return await spec.invoke(apiKeyBuffer, input);
        } catch (err) {
          return { data: (err as Error).message, isError: true };
        }
      });
    },
  });
}
