import assert from "node:assert/strict";
import { test } from "node:test";
import { ResendEffectExecutor, type TenantContactLookup } from "./effectExecutor.js";
import type { ProposedAction } from "./types.js";
import type { HandsKeyProvider, RequesterIdentity } from "@byok/vault";
import { SecretHandle } from "@byok/vault";

const REQUESTER: RequesterIdentity = { kind: "router-service", serviceId: "router" };

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: "action-1",
    tenantId: "tenant-a",
    agentName: "Ops digest",
    roleTitle: "Support Lead",
    taskType: "agent-42",
    summary: "This week's ops summary",
    draft: "Here's what happened this week...",
    stakesTags: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function contactsReturning(emails: string[]): TenantContactLookup {
  return { getOwnerEmails: async () => emails };
}

test('rejects any effect kind other than "send"', async () => {
  const vault: Pick<HandsKeyProvider, "resolveHandsKeyId" | "decryptHandsKey"> = {
    resolveHandsKeyId: async () => "key-1",
    decryptHandsKey: async () => new SecretHandle(Buffer.from("re_fake"), 1000),
  };
  const executor = new ResendEffectExecutor(contactsReturning(["founder@example.com"]), vault, REQUESTER);

  const result = await executor.execute({ kind: "pay", description: "..." }, action());
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error, /only handles "send"/);
});

test("fails clearly, not silently, when Resend isn't connected for this agent", async () => {
  const vault: Pick<HandsKeyProvider, "resolveHandsKeyId" | "decryptHandsKey"> = {
    resolveHandsKeyId: async () => null,
    decryptHandsKey: async () => {
      throw new Error("should never be called");
    },
  };
  const executor = new ResendEffectExecutor(contactsReturning(["founder@example.com"]), vault, REQUESTER);

  const result = await executor.execute({ kind: "send", description: "..." }, action());
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error, /isn't connected/);
});

test("fails clearly when the connected key can't be decrypted", async () => {
  const vault: Pick<HandsKeyProvider, "resolveHandsKeyId" | "decryptHandsKey"> = {
    resolveHandsKeyId: async () => "key-1",
    decryptHandsKey: async () => {
      throw new Error("revoked");
    },
  };
  const executor = new ResendEffectExecutor(contactsReturning(["founder@example.com"]), vault, REQUESTER);

  const result = await executor.execute({ kind: "send", description: "..." }, action());
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error, /Could not decrypt/);
});

test("fails clearly when the tenant has no owner/admin email on record", async () => {
  const vault: Pick<HandsKeyProvider, "resolveHandsKeyId" | "decryptHandsKey"> = {
    resolveHandsKeyId: async () => "key-1",
    decryptHandsKey: async () => new SecretHandle(Buffer.from("re_fake"), 1000),
  };
  const executor = new ResendEffectExecutor(contactsReturning([]), vault, REQUESTER);

  const result = await executor.execute({ kind: "send", description: "..." }, action());
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error, /No owner\/admin email/);
});

test("resolves the Hands key by (taskType, \"resend\") — taskType doubles as the router-level subAgentId", async () => {
  const seen: { tenantId?: string; subAgentId?: string; capabilityScope?: string } = {};
  const vault: Pick<HandsKeyProvider, "resolveHandsKeyId" | "decryptHandsKey"> = {
    resolveHandsKeyId: async (tenantId, subAgentId, capabilityScope) => {
      seen.tenantId = tenantId;
      seen.subAgentId = subAgentId;
      seen.capabilityScope = capabilityScope;
      return null; // short-circuit; this test only cares about the lookup args
    },
    decryptHandsKey: async () => {
      throw new Error("should never be called");
    },
  };
  const executor = new ResendEffectExecutor(contactsReturning(["founder@example.com"]), vault, REQUESTER);

  await executor.execute({ kind: "send", description: "..." }, action({ taskType: "agent-42", tenantId: "tenant-x" }));

  assert.equal(seen.tenantId, "tenant-x");
  assert.equal(seen.subAgentId, "agent-42");
  assert.equal(seen.capabilityScope, "resend");
});

test("a real send failure (Resend API rejects it) surfaces as a clear error, not a thrown exception or a silent success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("invalid api key", { status: 401 })) as typeof fetch;
  try {
    const vault: Pick<HandsKeyProvider, "resolveHandsKeyId" | "decryptHandsKey"> = {
      resolveHandsKeyId: async () => "key-1",
      decryptHandsKey: async () => new SecretHandle(Buffer.from("re_fake"), 1000),
    };
    const executor = new ResendEffectExecutor(contactsReturning(["founder@example.com"]), vault, REQUESTER);

    const result = await executor.execute({ kind: "send", description: "..." }, action());
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.error, /Resend send failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("on success, sends the action's own draft verbatim as the body — what a human approved is exactly what sends", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ to: string; subject: string; text: string }> = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(init!.body as string));
    return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
  }) as typeof fetch;
  try {
    const vault: Pick<HandsKeyProvider, "resolveHandsKeyId" | "decryptHandsKey"> = {
      resolveHandsKeyId: async () => "key-1",
      decryptHandsKey: async () => new SecretHandle(Buffer.from("re_fake"), 1000),
    };
    const executor = new ResendEffectExecutor(
      contactsReturning(["owner1@example.com", "owner2@example.com"]),
      vault,
      REQUESTER,
    );

    const result = await executor.execute(
      { kind: "send", description: "..." },
      action({ summary: "Weekly summary", draft: "3 tasks completed, 1 approval pending." }),
    );

    assert.deepEqual(result, { success: true });
    assert.equal(calls.length, 2, "one send per owner/admin email");
    for (const call of calls) {
      assert.equal(call.subject, "Weekly summary");
      assert.equal(call.text, "3 tasks completed, 1 approval pending.");
    }
    assert.deepEqual(calls.map((c) => c.to).sort(), ["owner1@example.com", "owner2@example.com"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
