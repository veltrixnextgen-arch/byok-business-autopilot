import assert from "node:assert/strict";
import { test } from "node:test";
import { NoPendingOfferError } from "../autonomyEngine.js";
import { DevOnlyAutonomyStoreGuardError, InMemoryDurableAutonomyStore } from "./autonomyStore.js";

test("offers autonomy exactly at the threshold, not before, and only once", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 3, spotCheckRate: 0 });

  for (let i = 0; i < 2; i++) {
    const result = await store.recordApproval("t1", "invoicing", []);
    assert.equal(result.offered, false);
  }
  const third = await store.recordApproval("t1", "invoicing", []);
  assert.equal(third.offered, true);
  assert.equal(third.consecutiveApprovals, 3);

  const fourth = await store.recordApproval("t1", "invoicing", []);
  assert.equal(fourth.offered, false, "must not re-offer once already offered");
});

test("autonomy is never self-enabled — isActive stays false until acceptOffer() is called", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
  await store.recordApproval("t1", "invoicing", []);
  assert.equal(await store.isActive("t1", "invoicing"), false);

  await store.acceptOffer("t1", "invoicing");
  assert.equal(await store.isActive("t1", "invoicing"), true);
});

test("acceptOffer without a pending offer throws", async () => {
  const store = new InMemoryDurableAutonomyStore();
  await assert.rejects(() => store.acceptOffer("t1", "invoicing"), NoPendingOfferError);
});

// The guarantee that used to live in autonomyEngine.test.ts, ported
// unchanged: deny-listed tags make recordApproval an unconditional
// no-op regardless of iteration count. Still cheap (in-memory, no I/O),
// so still runs the full million iterations, not a scaled-down proxy.
test("deny-list immunity: a million approvals on a deny-listed task type never yields an offer", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 10, spotCheckRate: 0 });

  for (let i = 0; i < 1_000_000; i += 1) {
    const result = await store.recordApproval("t1", "payments", ["money-movement"]);
    assert.equal(result.offered, false);
  }
  assert.equal(await store.isActive("t1", "payments"), false);
});

test("each deny-list tag independently blocks offers", async () => {
  const deniedTags = ["money-movement", "external-send-high-stakes", "deploy", "requires-professional-verification", "never-autonomous"];
  for (const tag of deniedTags) {
    const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
    const result = await store.recordApproval("t1", "some-task", [tag]);
    assert.equal(result.offered, false, `tag "${tag}" should have blocked the offer`);
  }
});

test("a normal rejection resets the counter but does not revoke already-active autonomy", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
  await store.recordApproval("t1", "invoicing", []);
  await store.acceptOffer("t1", "invoicing");

  await store.recordRejection("t1", "invoicing");
  assert.equal(await store.isActive("t1", "invoicing"), true);
  assert.equal((await store.stateFor("t1", "invoicing")).consecutiveApprovals, 0);
});

test("a rejection before reaching threshold resets progress toward the offer", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 5, spotCheckRate: 0 });
  await store.recordApproval("t1", "invoicing", []);
  await store.recordApproval("t1", "invoicing", []);
  await store.recordRejection("t1", "invoicing");
  assert.equal((await store.stateFor("t1", "invoicing")).consecutiveApprovals, 0);
});

test("a spot-check rejection auto-revokes active autonomy", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
  await store.recordApproval("t1", "invoicing", []);
  await store.acceptOffer("t1", "invoicing");

  await store.recordSpotCheckRejection("t1", "invoicing");
  assert.equal(await store.isActive("t1", "invoicing"), false);
});

test("shouldSpotCheck is deterministic given an injected RNG", () => {
  let callIndex = 0;
  const scripted = [0.05, 0.5, 0.05, 0.99]; // < 0.1 => spot-check, else bypass
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0.1 }, () => scripted[callIndex++]!);

  assert.equal(store.shouldSpotCheck(), true); // 0.05 < 0.1
  assert.equal(store.shouldSpotCheck(), false); // 0.5 >= 0.1
  assert.equal(store.shouldSpotCheck(), true); // 0.05 < 0.1
  assert.equal(store.shouldSpotCheck(), false); // 0.99 >= 0.1
});

test("revoke(tenantId, taskType) revokes exactly that task type and reports it as revoked", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
  await store.recordApproval("t1", "invoicing", []);
  await store.acceptOffer("t1", "invoicing");
  await store.recordApproval("t1", "outreach", []);
  await store.acceptOffer("t1", "outreach");

  const { revokedTaskTypes } = await store.revoke("t1", "invoicing");
  assert.deepEqual(revokedTaskTypes, ["invoicing"]);
  assert.equal(await store.isActive("t1", "invoicing"), false);
  assert.equal(await store.isActive("t1", "outreach"), true);
});

test("revoke(tenantId) with no taskType revokes every active task type for that tenant only, and reports all of them", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
  await store.recordApproval("t1", "invoicing", []);
  await store.acceptOffer("t1", "invoicing");
  await store.recordApproval("t1", "outreach", []);
  await store.acceptOffer("t1", "outreach");
  await store.recordApproval("t2", "invoicing", []);
  await store.acceptOffer("t2", "invoicing");

  const { revokedTaskTypes } = await store.revoke("t1");
  assert.deepEqual(new Set(revokedTaskTypes), new Set(["invoicing", "outreach"]));
  assert.equal(await store.isActive("t1", "invoicing"), false);
  assert.equal(await store.isActive("t1", "outreach"), false);
  assert.equal(await store.isActive("t2", "invoicing"), true, "tenant t2 must be unaffected");
});

test("revoking an already-inactive task type reports it as NOT revoked (empty list), not a duplicate/phantom entry", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
  // Never accepted — offered but not active.
  await store.recordApproval("t1", "invoicing", []);

  const { revokedTaskTypes } = await store.revoke("t1", "invoicing");
  assert.deepEqual(revokedTaskTypes, [], "nothing was active, so nothing should be reported as revoked");
});

test("per (tenant, task-type) isolation: same task type, different tenants, independent counters", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 3, spotCheckRate: 0 });
  await store.recordApproval("t1", "invoicing", []);
  await store.recordApproval("t1", "invoicing", []);
  await store.recordApproval("t2", "invoicing", []);

  assert.equal((await store.stateFor("t1", "invoicing")).consecutiveApprovals, 2);
  assert.equal((await store.stateFor("t2", "invoicing")).consecutiveApprovals, 1);
});

// ADR-028's principle: a construction guard lands with the fix, never
// added after the fact. Same reasoning as every other InMemoryDurableX
// store in this codebase (approvalStore.ts, packages/vault's
// dekRecordStore.ts) — this class resets on every restart and nothing
// outside this process can ever see a tenant's autonomy state held in it.
test("refuses to construct outside a dev/test environment", () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(() => new InMemoryDurableAutonomyStore(), DevOnlyAutonomyStoreGuardError);
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
