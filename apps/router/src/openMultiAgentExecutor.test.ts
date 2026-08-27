import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { SecretHandle } from "@byok/vault";
import type { BrainKeyProvider, HandsKeyProvider, RequesterIdentity } from "@byok/vault";
import { OpenMultiAgentExecutor } from "./openMultiAgentExecutor.js";
import type { HandsToolSpec } from "./handsTool.js";
import type { RouterTask } from "./types.js";

const ROUTER: RequesterIdentity = { kind: "router-service", serviceId: "router-1" };

function makeTask(overrides: Partial<RouterTask> = {}): RouterTask {
  return {
    id: "task-1",
    tenantId: "default",
    subAgentId: "invoicing",
    teamId: "cfo",
    title: "Create invoice",
    payload: "Create an invoice for order #123",
    tags: [],
    dedupKey: "dedup-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "pending",
    promptTier: "sub-agent",
    ...overrides,
  };
}

test("pulls the Brain key for the task's tenant + team (role), not a hardcoded one", async () => {
  const requestedKeys: Array<{ tenantId: string; roleId: string }> = [];
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey(tenantId, roleId) {
      requestedKeys.push({ tenantId, roleId });
      return { handle: new SecretHandle(Buffer.from("sk-ant-fake-key-0001"), 60_000), provider: "anthropic" };
    },
  };

  let calledWithApiKey: string | undefined;
  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "claude-sonnet-4-6", (apiKey) => {
    calledWithApiKey = apiKey;
    return { runAgent: async () => ({ output: "mock output" }) as never };
  });

  const outcome = await executor.execute(makeTask({ tenantId: "tenant-b", teamId: "cmo" }));

  // Both dimensions must reach the vault — a role id alone isn't unique
  // across tenants (issue #15's own cross-tenant Vault fix).
  assert.deepEqual(requestedKeys, [{ tenantId: "tenant-b", roleId: "cmo" }]);
  assert.equal(calledWithApiKey, "sk-ant-fake-key-0001");
  assert.deepEqual(outcome, { result: "mock output" });
});

test("R2/ADR-024: task.systemPrompt reaches runAgent's config verbatim, composed by the router per dispatch", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() {
      return { handle: new SecretHandle(Buffer.from("sk-ant-fake-key-0003"), 60_000), provider: "anthropic" };
    },
  };

  let seenConfig: { systemPrompt?: string } | undefined;
  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "claude-sonnet-4-6", () => ({
    runAgent: async (config) => {
      seenConfig = config as { systemPrompt?: string };
      return { output: "ok" } as never;
    },
  }));

  await executor.execute(makeTask({ systemPrompt: "You are Sam, the invoicing agent. Only draft, never send." }));

  assert.equal(seenConfig?.systemPrompt, "You are Sam, the invoicing agent. Only draft, never send.");
});

test("omits systemPrompt entirely (not an empty string) when the task carries none — pre-R2 callers unaffected", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() {
      return { handle: new SecretHandle(Buffer.from("sk-ant-fake-key-0004"), 60_000), provider: "anthropic" };
    },
  };

  let sawSystemPromptKey = false;
  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "claude-sonnet-4-6", () => ({
    runAgent: async (config) => {
      sawSystemPromptKey = "systemPrompt" in config;
      return { output: "ok" } as never;
    },
  }));

  await executor.execute(makeTask());

  assert.equal(sawSystemPromptKey, false);
});

test("uses task.model (the cost gate's own choice, possibly a DOWNGRADE) over the constructor's fixed model", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() {
      return { handle: new SecretHandle(Buffer.from("sk-ant-fake-model-1"), 60_000), provider: "anthropic" };
    },
  };

  let seenModel: string | undefined;
  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "claude-opus-4-6", () => ({
    runAgent: async (config: { model?: string }) => {
      seenModel = config.model;
      return { output: "ok" } as never;
    },
  }));

  await executor.execute(makeTask({ model: "claude-haiku-4-5-20251001" }));

  assert.equal(seenModel, "claude-haiku-4-5-20251001");
});

test("falls back to the constructor's fixed model when task.model is unset (no CostGate configured)", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() {
      return { handle: new SecretHandle(Buffer.from("sk-ant-fake-model-2"), 60_000), provider: "anthropic" };
    },
  };

  let seenModel: string | undefined;
  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "claude-sonnet-4-6", () => ({
    runAgent: async (config: { model?: string }) => {
      seenModel = config.model;
      return { output: "ok" } as never;
    },
  }));

  await executor.execute(makeTask({ model: undefined }));

  assert.equal(seenModel, "claude-sonnet-4-6");
});

test("zeroes the secret handle after the call completes", async () => {
  const handle = new SecretHandle(Buffer.from("sk-ant-fake-key-0002"), 60_000);
  const fakeVault: BrainKeyProvider = { async decryptBrainKey() { return { handle, provider: "anthropic" }; } };

  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "claude-sonnet-4-6", () => ({
    runAgent: async () => ({ output: "done" }) as never,
  }));

  assert.equal(handle.isZeroed, false);
  await executor.execute(makeTask());
  assert.equal(handle.isZeroed, true);
});

// Multi-provider AI (Phase 2 item 5): agent.js:122 in @open-multi-agent/core
// defaults `provider` to 'anthropic' whenever the run config omits it — it
// never infers a provider from the model string. Before this wiring, the
// executor never set `provider` at all, so a role whose vault key was
// actually OpenAI or Google would still silently dispatch through the
// Anthropic adapter with that (wrong) model name. This is the regression
// test: the vault's own stored provider must reach runAgent's config.
test("a non-Anthropic provider stored in the vault reaches runAgent's config, not a silent Anthropic default", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() {
      return { handle: new SecretHandle(Buffer.from("sk-proj-fake-openai-key"), 60_000), provider: "openai" };
    },
  };

  let seenProvider: string | undefined;
  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "gpt-4o", () => ({
    runAgent: async (config: { provider?: string }) => {
      seenProvider = config.provider;
      return { output: "ok" } as never;
    },
  }));

  await executor.execute(makeTask());

  assert.equal(seenProvider, "openai");
});

// Our own BrainProvider id ("google", matching the connect screen and
// Google's own API — apps/api/src/brainKeys/providerValidation.ts) doesn't
// match @open-multi-agent/core's SupportedProvider id for the same
// provider ("gemini") — createAdapter() only recognizes "gemini" and
// throws on any other string. This proves the executor translates rather
// than passing our stored id straight through.
test("vault's 'google' provider id is translated to @open-multi-agent/core's 'gemini' before reaching runAgent", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() {
      return { handle: new SecretHandle(Buffer.from("sk-fake-google-key"), 60_000), provider: "google" };
    },
  };

  let seenProvider: string | undefined;
  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "gemini-2.5-pro", () => ({
    runAgent: async (config: { provider?: string }) => {
      seenProvider = config.provider;
      return { output: "ok" } as never;
    },
  }));

  await executor.execute(makeTask());

  assert.equal(seenProvider, "gemini");
});

test("gracefully returns an error outcome when no Brain key is configured for the role — never throws", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey(_tenantId, roleId) {
      throw new Error(`No active Brain key for role "${roleId}".`);
    },
  };

  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "claude-sonnet-4-6", () => {
    throw new Error("orchestratorFactory should never be called when the key lookup fails");
  });

  const outcome = await executor.execute(makeTask({ teamId: "sales" }));
  assert.ok("error" in outcome);
  assert.match((outcome as { error: string }).error, /Brain key unavailable for role "sales"/);
});

test("a provider/orchestrator error surfaces as {error}, not a hang or an unhandled rejection", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() { return { handle: new SecretHandle(Buffer.from("sk-ant-fake-0005"), 60_000), provider: "anthropic" }; },
  };

  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "claude-sonnet-4-6", () => ({
    runAgent: async () => { throw new Error("upstream provider returned 500"); },
  }));

  const outcome = await executor.execute(makeTask());
  assert.ok("error" in outcome);
  assert.match((outcome as { error: string }).error, /upstream provider returned 500/);
});

function makeHandsSpec(overrides: Partial<HandsToolSpec> = {}): HandsToolSpec {
  return {
    name: "send_invoice",
    description: "Create and send an invoice via Stripe",
    inputSchema: z.object({ amountUsd: z.number() }),
    subAgentId: "invoicing",
    capabilityScope: "stripe:invoices:write",
    service: "stripe",
    invoke: async () => ({ data: "ok" }),
    ...overrides,
  };
}

test("only registers Hands tools whose subAgentId matches the running task — a hijacked agent can't even see another sub-agent's tool", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() { return { handle: new SecretHandle(Buffer.from("sk-ant-fake-0006"), 60_000), provider: "anthropic" }; },
  };
  const fakeHandsVault: HandsKeyProvider = {
    async decryptHandsKey() { return new SecretHandle(Buffer.from("sk-hands-fake-0006"), 60_000); },
    resolveHandsKeyId: async () => "hands-key-1",
  };
  const handsTools: HandsToolSpec[] = [
    makeHandsSpec({ name: "send_invoice", subAgentId: "invoicing" }),
    makeHandsSpec({ name: "post_to_stripe_payouts", subAgentId: "finance-agent" }),
  ];

  let seenToolNames: string[] = [];
  const executor = new OpenMultiAgentExecutor(
    fakeVault,
    ROUTER,
    "claude-sonnet-4-6",
    () => ({
      runAgent: async (config: { customTools?: readonly { name: string }[] }) => {
        seenToolNames = (config.customTools ?? []).map((t) => t.name);
        return { output: "done" } as never;
      },
    }),
    fakeHandsVault,
    handsTools,
  );

  await executor.execute(makeTask({ subAgentId: "invoicing" }));
  assert.deepEqual(seenToolNames, ["send_invoice"]);
});

test("Hands key never leaves its SecretHandle across repeated tool calls within one run", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() { return { handle: new SecretHandle(Buffer.from("sk-ant-fake-0007"), 60_000), provider: "anthropic" }; },
  };

  const issuedHandles: SecretHandle[] = [];
  const fakeHandsVault: HandsKeyProvider = {
    async decryptHandsKey() {
      const handle = new SecretHandle(Buffer.from("sk-hands-fake-0007"), 60_000);
      issuedHandles.push(handle);
      return handle;
    },
    resolveHandsKeyId: async () => "hands-key-1",
  };
  const handsTools: HandsToolSpec[] = [makeHandsSpec({ subAgentId: "invoicing" })];

  const executor = new OpenMultiAgentExecutor(
    fakeVault,
    ROUTER,
    "claude-sonnet-4-6",
    () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runAgent: async (config: { customTools?: readonly { execute: (i: any, c: any) => Promise<any> }[] }) => {
        const tool = config.customTools?.[0];
        await tool?.execute({ amountUsd: 1 }, {});
        await tool?.execute({ amountUsd: 2 }, {});
        return { output: "done" } as never;
      },
    }),
    fakeHandsVault,
    handsTools,
  );

  await executor.execute(makeTask({ subAgentId: "invoicing" }));

  assert.equal(issuedHandles.length, 2);
  assert.ok(issuedHandles.every((h) => h.isZeroed), "every Hands SecretHandle issued during the run must be zeroed");
});

test("omitting handsVault preserves the previous plain-text-only behavior exactly — no customTools sent at all", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() { return { handle: new SecretHandle(Buffer.from("sk-ant-fake-0008"), 60_000), provider: "anthropic" }; },
  };

  let sawCustomToolsKey = true;
  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "claude-sonnet-4-6", () => ({
    runAgent: async (config: { customTools?: unknown }) => {
      sawCustomToolsKey = "customTools" in config;
      return { output: "done" } as never;
    },
  }));

  await executor.execute(makeTask());
  assert.equal(sawCustomToolsKey, false);
});

test("issue #22: a Hands tool whose key isn't connected for this tenant is excluded from customTools, and its service is reported as missingHands", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() { return { handle: new SecretHandle(Buffer.from("sk-ant-fake-0009"), 60_000), provider: "anthropic" }; },
  };
  const connectedScopes = new Set(["invoicing::stripe:invoices:write"]);
  const fakeHandsVault: HandsKeyProvider = {
    async decryptHandsKey() { return new SecretHandle(Buffer.from("sk-hands-fake-0009"), 60_000); },
    resolveHandsKeyId: async (_tenantId, subAgentId, capabilityScope) =>
      connectedScopes.has(`${subAgentId}::${capabilityScope}`) ? "hands-key-1" : null,
  };
  const handsTools: HandsToolSpec[] = [
    makeHandsSpec({ name: "send_invoice", capabilityScope: "stripe:invoices:write", service: "stripe" }),
    makeHandsSpec({ name: "send_reminder_email", capabilityScope: "resend:send", service: "resend" }),
  ];

  let seenToolNames: string[] = [];
  const executor = new OpenMultiAgentExecutor(
    fakeVault,
    ROUTER,
    "claude-sonnet-4-6",
    () => ({
      runAgent: async (config: { customTools?: readonly { name: string }[] }) => {
        seenToolNames = (config.customTools ?? []).map((t) => t.name);
        return { output: "drafted the reminder" } as never;
      },
    }),
    fakeHandsVault,
    handsTools,
  );

  const outcome = await executor.execute(makeTask({ subAgentId: "invoicing" }));

  assert.deepEqual(seenToolNames, ["send_invoice"]); // resend tool excluded — not connected
  assert.deepEqual(outcome, { result: "drafted the reminder", missingHands: ["resend"] });
});

test("issue #22: when every needed Hands tool IS connected, missingHands is absent from the outcome entirely", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() { return { handle: new SecretHandle(Buffer.from("sk-ant-fake-0010"), 60_000), provider: "anthropic" }; },
  };
  const fakeHandsVault: HandsKeyProvider = {
    async decryptHandsKey() { return new SecretHandle(Buffer.from("sk-hands-fake-0010"), 60_000); },
    resolveHandsKeyId: async () => "hands-key-1",
  };
  const handsTools: HandsToolSpec[] = [makeHandsSpec({ subAgentId: "invoicing" })];

  const executor = new OpenMultiAgentExecutor(
    fakeVault,
    ROUTER,
    "claude-sonnet-4-6",
    () => ({ runAgent: async () => ({ output: "sent" }) as never }),
    fakeHandsVault,
    handsTools,
  );

  const outcome = await executor.execute(makeTask({ subAgentId: "invoicing" }));
  assert.deepEqual(outcome, { result: "sent" });
  assert.ok(!("missingHands" in outcome));
});

// PR 2A's verified gap (ADR-020): missingHands used to come ONLY from the
// pre-flight resolveHandsKeyId filter, before the LLM's run even starts.
// A tool that WAS connected pre-flight (resolveHandsKeyId returns a real
// id) but fails when actually called — decrypt error, or an OAuth refresh
// failure — never reached missingHands, so the router could still submit
// the caller's original requested effect even though the Hands call never
// actually succeeded. This is the regression test for the fix: a live
// decrypt failure must land in missingHands exactly like a pre-flight
// absence does.
test("PR 2A: a Hands tool connected at pre-flight but failing on the actual call (e.g. an OAuth refresh failure) still lands in missingHands", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() { return { handle: new SecretHandle(Buffer.from("sk-ant-fake-0011"), 60_000), provider: "anthropic" }; },
  };
  const fakeHandsVault: HandsKeyProvider = {
    // Connected at pre-flight (a real key id comes back)...
    resolveHandsKeyId: async () => "hands-key-1",
    // ...but the actual decrypt (where OAuth's refresh-on-expiry lives)
    // fails — simulating an expired credential whose refresh just failed.
    async decryptHandsKey() {
      throw new Error("token expired and refresh failed");
    },
  };
  const handsTools: HandsToolSpec[] = [makeHandsSpec({ name: "post_to_calendar", service: "google-calendar", subAgentId: "scheduling" })];

  const executor = new OpenMultiAgentExecutor(
    fakeVault,
    ROUTER,
    "claude-sonnet-4-6",
    () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runAgent: async (config: { customTools?: readonly { execute: (i: any, c: any) => Promise<any> }[] }) => {
        // The tool IS offered (pre-flight said connected) — the LLM calls
        // it, gets a clean isError result, and still produces some output.
        const tool = config.customTools?.[0];
        const result = await tool?.execute({}, {});
        assert.equal(result?.isError, true);
        return { output: "drafted anyway" } as never;
      },
    }),
    fakeHandsVault,
    handsTools,
  );

  const outcome = await executor.execute(makeTask({ subAgentId: "scheduling" }));

  assert.deepEqual(outcome, { result: "drafted anyway", missingHands: ["google-calendar"] });
});
