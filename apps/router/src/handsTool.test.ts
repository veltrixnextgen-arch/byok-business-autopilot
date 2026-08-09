import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { KeyNotFoundError, ScopeBindingError, SecretHandle } from "@byok/vault";
import type { HandsKeyProvider, RequesterIdentity } from "@byok/vault";
import { createHandsTool, type HandsToolSpec } from "./handsTool.js";

const ROUTER: RequesterIdentity = { kind: "router-service", serviceId: "router-1" };

function makeSpec(overrides: Partial<HandsToolSpec> = {}): HandsToolSpec {
  return {
    name: "send_invoice",
    description: "Create and send an invoice via Stripe",
    inputSchema: z.object({ amountUsd: z.number() }),
    keyId: "hands-key-1",
    subAgentId: "invoicing",
    capabilityScope: "stripe:invoices:write",
    invoke: async (_apiKey, input) => ({ data: `sent $${(input as { amountUsd: number }).amountUsd}` }),
    ...overrides,
  };
}

test("decrypts just-in-time and zeroes the handle after the call completes", async () => {
  const handle = new SecretHandle(Buffer.from("sk-hands-fake-0001"), 60_000);
  let decryptCalls = 0;
  const handsVault: HandsKeyProvider = {
    async decryptHandsKey() {
      decryptCalls++;
      return handle;
    },
  };

  const tool = createHandsTool(makeSpec(), handsVault, ROUTER);
  assert.equal(handle.isZeroed, false);

  const result = await tool.execute({ amountUsd: 42 }, {} as never);

  assert.equal(decryptCalls, 1);
  assert.equal(handle.isZeroed, true);
  assert.deepEqual(result, { data: "sent $42" });
});

test("claims the spec's own fixed subAgentId+capabilityScope, not anything from tool input", async () => {
  const claims: { subAgentId: string; capabilityScope: string }[] = [];
  const handsVault: HandsKeyProvider = {
    async decryptHandsKey(_keyId, requestedBy) {
      claims.push(requestedBy);
      return new SecretHandle(Buffer.from("sk-hands-fake-0002"), 60_000);
    },
  };

  const tool = createHandsTool(makeSpec({ subAgentId: "invoicing", capabilityScope: "stripe:invoices:write" }), handsVault, ROUTER);
  // Even if a hijacked model tried to smuggle a different scope via input,
  // the tool has no input field that could influence the claim at all.
  await tool.execute({ amountUsd: 1, subAgentId: "finance-agent", capabilityScope: "stripe:payouts:write" } as never, {} as never);

  assert.deepEqual(claims, [{ subAgentId: "invoicing", capabilityScope: "stripe:invoices:write" }]);
});

test("a scope-binding mismatch surfaces as a clean isError tool result, not a throw", async () => {
  const handsVault: HandsKeyProvider = {
    async decryptHandsKey() {
      throw new ScopeBindingError('Hands key "hands-key-1" is not bound to subAgentId="invoicing", capabilityScope="stripe:invoices:write".');
    },
  };

  const tool = createHandsTool(makeSpec(), handsVault, ROUTER);
  const result = await tool.execute({ amountUsd: 42 }, {} as never);

  assert.equal(result.isError, true);
  assert.match(result.data, /not bound to subAgentId/);
});

test("a key revoked mid-run surfaces cleanly on the next call, rather than hanging or crashing the whole agent run", async () => {
  let call = 0;
  const handsVault: HandsKeyProvider = {
    async decryptHandsKey() {
      call++;
      if (call === 1) return new SecretHandle(Buffer.from("sk-hands-fake-0003"), 60_000);
      throw new KeyNotFoundError('No active Hands key "hands-key-1".');
    },
  };

  const tool = createHandsTool(makeSpec(), handsVault, ROUTER);

  const first = await tool.execute({ amountUsd: 10 }, {} as never);
  assert.equal(first.isError, undefined);
  assert.equal(first.data, "sent $10");

  const second = await tool.execute({ amountUsd: 20 }, {} as never);
  assert.equal(second.isError, true);
  assert.match(second.data, /No active Hands key/);
});

test("the underlying service call (invoke) throwing surfaces as an isError tool result, not an unhandled rejection", async () => {
  const handsVault: HandsKeyProvider = {
    async decryptHandsKey() {
      return new SecretHandle(Buffer.from("sk-hands-fake-0004"), 60_000);
    },
  };

  const tool = createHandsTool(
    makeSpec({ invoke: async () => { throw new Error("Stripe API returned 503"); } }),
    handsVault,
    ROUTER,
  );

  const result = await tool.execute({ amountUsd: 5 }, {} as never);
  assert.equal(result.isError, true);
  assert.match(result.data, /Stripe API returned 503/);
});
