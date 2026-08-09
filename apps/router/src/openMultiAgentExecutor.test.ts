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
    ...overrides,
  };
}

test("pulls the Brain key for the task's team (role), not a hardcoded one", async () => {
  const requestedRoleIds: string[] = [];
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey(roleId) {
      requestedRoleIds.push(roleId);
      return new SecretHandle(Buffer.from("sk-ant-fake-key-0001"), 60_000);
    },
  };

  let calledWithApiKey: string | undefined;
  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "claude-sonnet-4-6", (apiKey) => {
    calledWithApiKey = apiKey;
    return { runAgent: async () => ({ output: "mock output" }) as never };
  });

  const outcome = await executor.execute(makeTask({ teamId: "cmo" }));

  assert.deepEqual(requestedRoleIds, ["cmo"]);
  assert.equal(calledWithApiKey, "sk-ant-fake-key-0001");
  assert.deepEqual(outcome, { result: "mock output" });
});

test("zeroes the secret handle after the call completes", async () => {
  const handle = new SecretHandle(Buffer.from("sk-ant-fake-key-0002"), 60_000);
  const fakeVault: BrainKeyProvider = { async decryptBrainKey() { return handle; } };

  const executor = new OpenMultiAgentExecutor(fakeVault, ROUTER, "claude-sonnet-4-6", () => ({
    runAgent: async () => ({ output: "done" }) as never,
  }));

  assert.equal(handle.isZeroed, false);
  await executor.execute(makeTask());
  assert.equal(handle.isZeroed, true);
});

test("gracefully returns an error outcome when no Brain key is configured for the role — never throws", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey(roleId) {
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
    async decryptBrainKey() { return new SecretHandle(Buffer.from("sk-ant-fake-0005"), 60_000); },
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
    keyId: "hands-key-1",
    subAgentId: "invoicing",
    capabilityScope: "stripe:invoices:write",
    invoke: async () => ({ data: "ok" }),
    ...overrides,
  };
}

test("only registers Hands tools whose subAgentId matches the running task — a hijacked agent can't even see another sub-agent's tool", async () => {
  const fakeVault: BrainKeyProvider = {
    async decryptBrainKey() { return new SecretHandle(Buffer.from("sk-ant-fake-0006"), 60_000); },
  };
  const fakeHandsVault: HandsKeyProvider = {
    async decryptHandsKey() { return new SecretHandle(Buffer.from("sk-hands-fake-0006"), 60_000); },
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
    async decryptBrainKey() { return new SecretHandle(Buffer.from("sk-ant-fake-0007"), 60_000); },
  };

  const issuedHandles: SecretHandle[] = [];
  const fakeHandsVault: HandsKeyProvider = {
    async decryptHandsKey() {
      const handle = new SecretHandle(Buffer.from("sk-hands-fake-0007"), 60_000);
      issuedHandles.push(handle);
      return handle;
    },
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
    async decryptBrainKey() { return new SecretHandle(Buffer.from("sk-ant-fake-0008"), 60_000); },
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
