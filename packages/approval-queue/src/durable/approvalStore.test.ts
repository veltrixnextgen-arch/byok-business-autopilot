import assert from "node:assert/strict";
import { test } from "node:test";
import { UnknownActionError, UnknownRecommendationError, type ProposedAction, type RecommendationItem } from "../types.js";
import { InMemoryDurableApprovalStore } from "./approvalStore.js";

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: "action-1",
    tenantId: "t1",
    agentName: "Invoicing Agent",
    roleTitle: "CFO",
    taskType: "invoicing",
    summary: "Draft invoice",
    draft: "...",
    stakesTags: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRecommendation(overrides: Partial<RecommendationItem> = {}): RecommendationItem {
  return {
    id: "rec-1",
    tenantId: "t1",
    agentName: "CEO",
    roleTitle: "CEO",
    summary: "Consider raising prices",
    draft: "...",
    stakesTags: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("submitted actions show up as pending until resolved", async () => {
  const store = new InMemoryDurableApprovalStore();
  await store.submitProposedAction(makeAction(), false);

  const pending = await store.pendingActions("t1");
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.id, "action-1");
});

test("resolve removes the action from pending and returns it plus the spot-check flag", async () => {
  const store = new InMemoryDurableApprovalStore();
  await store.submitProposedAction(makeAction(), true);

  const outcome = await store.resolve("t1", "action-1", { kind: "APPROVE" });
  assert.equal(outcome.wasSpotCheck, true);
  assert.equal((await store.pendingActions("t1")).length, 0);
});

test("resolving an unknown or already-resolved action throws", async () => {
  const store = new InMemoryDurableApprovalStore();
  await store.submitProposedAction(makeAction(), false);
  await store.resolve("t1", "action-1", { kind: "APPROVE" });

  await assert.rejects(() => store.resolve("t1", "action-1", { kind: "APPROVE" }), UnknownActionError);
  await assert.rejects(() => store.resolve("t1", "not-real", { kind: "APPROVE" }), UnknownActionError);
});

test("recommendations are tracked separately from proposed actions", async () => {
  const store = new InMemoryDurableApprovalStore();
  await store.submitRecommendation(makeRecommendation());

  assert.equal((await store.pendingActions("t1")).length, 0);
  assert.equal((await store.pendingRecommendations("t1")).length, 1);

  const resolved = await store.resolveRecommendation("t1", "rec-1");
  assert.equal(resolved.id, "rec-1");
  assert.equal((await store.pendingRecommendations("t1")).length, 0);
});

test("resolving an unknown recommendation throws", async () => {
  const store = new InMemoryDurableApprovalStore();
  await assert.rejects(() => store.resolveRecommendation("t1", "not-real"), UnknownRecommendationError);
});

test("items are isolated per tenant", async () => {
  const store = new InMemoryDurableApprovalStore();
  await store.submitProposedAction(makeAction({ id: "a1", tenantId: "t1" }), false);
  await store.submitProposedAction(makeAction({ id: "a2", tenantId: "t2" }), false);

  assert.equal((await store.pendingActions("t1")).length, 1);
  assert.equal((await store.pendingActions("t2")).length, 1);
  await assert.rejects(() => store.resolve("t2", "a1", { kind: "APPROVE" }), UnknownActionError, "tenant t2 must not be able to resolve tenant t1's action");
});
