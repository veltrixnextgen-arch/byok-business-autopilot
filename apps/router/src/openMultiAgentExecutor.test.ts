import { test } from "node:test";
import assert from "node:assert/strict";
import { SecretHandle } from "@byok/vault";
import type { BrainKeyProvider, RequesterIdentity } from "@byok/vault";
import { OpenMultiAgentExecutor } from "./openMultiAgentExecutor.js";
import type { RouterTask } from "./types.js";

const ROUTER: RequesterIdentity = { kind: "router-service", serviceId: "router-1" };

function makeTask(overrides: Partial<RouterTask> = {}): RouterTask {
  return {
    id: "task-1",
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
