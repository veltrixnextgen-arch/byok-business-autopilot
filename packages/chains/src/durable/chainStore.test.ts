import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDurableChainStore, UnknownChainError } from "./chainStore.js";
import type { Chain, ChainStep } from "../types.js";

const NOW = new Date("2026-08-27T12:00:00.000Z");

function makeStep(id: string): ChainStep {
  return { id, agentId: "agent-1", subAgentId: "invoicing", description: "a step", requiresApproval: false, status: "pending" };
}

function newChainInput(overrides: Partial<Omit<Chain, "id">> = {}): Omit<Chain, "id"> {
  return {
    tenantId: "tenant-1",
    triggerSummary: "Overdue invoice detected",
    steps: [makeStep("step-1")],
    currentStepIndex: 0,
    status: "running",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

test("create assigns an id and get returns exactly what was created", async () => {
  const store = new InMemoryDurableChainStore();
  const created = await store.create(newChainInput());

  assert.ok(created.id);
  const fetched = await store.get("tenant-1", created.id);
  assert.deepEqual(fetched, created);
});

test("get returns null for a chain that doesn't exist", async () => {
  const store = new InMemoryDurableChainStore();
  assert.equal(await store.get("tenant-1", "not-a-real-id"), null);
});

test("get scopes by tenant — another tenant's id never resolves, even if it exists", async () => {
  const store = new InMemoryDurableChainStore();
  const created = await store.create(newChainInput({ tenantId: "tenant-a" }));

  assert.equal(await store.get("tenant-b", created.id), null);
  assert.ok(await store.get("tenant-a", created.id));
});

test("save persists a full read-modify-write", async () => {
  const store = new InMemoryDurableChainStore();
  const created = await store.create(newChainInput());

  const updated: Chain = { ...created, status: "completed", currentStepIndex: 1, updatedAt: new Date(NOW.getTime() + 1000).toISOString() };
  await store.save(updated);

  const fetched = await store.get("tenant-1", created.id);
  assert.equal(fetched?.status, "completed");
  assert.equal(fetched?.currentStepIndex, 1);
});

test("save throws UnknownChainError for a chain id that was never created", async () => {
  const store = new InMemoryDurableChainStore();
  const fake: Chain = { ...newChainInput(), id: "never-created" };
  await assert.rejects(() => store.save(fake), UnknownChainError);
});

test("listByTenant returns only that tenant's chains", async () => {
  const store = new InMemoryDurableChainStore();
  await store.create(newChainInput({ tenantId: "tenant-a" }));
  await store.create(newChainInput({ tenantId: "tenant-a" }));
  await store.create(newChainInput({ tenantId: "tenant-b" }));

  const chainsA = await store.listByTenant("tenant-a");
  const chainsB = await store.listByTenant("tenant-b");
  assert.equal(chainsA.length, 2);
  assert.equal(chainsB.length, 1);
  assert.ok(chainsA.every((c) => c.tenantId === "tenant-a"));
});
