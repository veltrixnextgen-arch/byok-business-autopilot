import assert from "node:assert/strict";
import { test } from "node:test";
import { NoPendingOfferError } from "../autonomyEngine.js";
import { InMemoryDurableAutonomyStore } from "./autonomyStore.js";

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

test("deny-list immunity: approvals for a deny-listed task type never yield an offer", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
  for (let i = 0; i < 50; i++) {
    const result = await store.recordApproval("t1", "invoicing", ["money-movement"]);
    assert.equal(result.offered, false);
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

test("a spot-check rejection auto-revokes active autonomy", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
  await store.recordApproval("t1", "invoicing", []);
  await store.acceptOffer("t1", "invoicing");

  await store.recordSpotCheckRejection("t1", "invoicing");
  assert.equal(await store.isActive("t1", "invoicing"), false);
});

test("revoke(tenantId, taskType) revokes exactly that task type", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
  await store.recordApproval("t1", "invoicing", []);
  await store.acceptOffer("t1", "invoicing");
  await store.recordApproval("t1", "outreach", []);
  await store.acceptOffer("t1", "outreach");

  await store.revoke("t1", "invoicing");
  assert.equal(await store.isActive("t1", "invoicing"), false);
  assert.equal(await store.isActive("t1", "outreach"), true);
});

test("revoke(tenantId) with no taskType revokes every active task type for that tenant only", async () => {
  const store = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
  await store.recordApproval("t1", "invoicing", []);
  await store.acceptOffer("t1", "invoicing");
  await store.recordApproval("t2", "invoicing", []);
  await store.acceptOffer("t2", "invoicing");

  await store.revoke("t1");
  assert.equal(await store.isActive("t1", "invoicing"), false);
  assert.equal(await store.isActive("t2", "invoicing"), true, "tenant t2 must be unaffected");
});
