import { test } from "node:test";
import assert from "node:assert/strict";
import { AutonomyEngine, NoPendingOfferError } from "./autonomyEngine.js";

test("offers autonomy exactly at the threshold, not before, and only once", () => {
  const events: string[] = [];
  const engine = new AutonomyEngine({ offerThreshold: 3, spotCheckRate: 0 });
  engine.onEvent((e) => events.push(e.type));

  engine.recordApproval("tenant-a", "invoicing", []);
  engine.recordApproval("tenant-a", "invoicing", []);
  assert.deepEqual(events, [], "no offer before the threshold");

  engine.recordApproval("tenant-a", "invoicing", []);
  assert.deepEqual(events, ["autonomy.offered"]);

  // Further approvals (autonomy not yet accepted) must not re-offer.
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.recordApproval("tenant-a", "invoicing", []);
  assert.deepEqual(events, ["autonomy.offered"]);
});

test("autonomy is never self-enabled — isActive stays false until acceptOffer() is explicitly called", () => {
  const engine = new AutonomyEngine({ offerThreshold: 2, spotCheckRate: 0 });
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.recordApproval("tenant-a", "invoicing", []);
  assert.equal(engine.isActive("tenant-a", "invoicing"), false);

  engine.acceptOffer("tenant-a", "invoicing");
  assert.equal(engine.isActive("tenant-a", "invoicing"), true);
});

test("acceptOffer without a pending offer throws", () => {
  const engine = new AutonomyEngine();
  assert.throws(() => engine.acceptOffer("tenant-a", "invoicing"), NoPendingOfferError);
});

test("deny-list immunity: a million approvals on a deny-listed task type never yields an offer", () => {
  const events: string[] = [];
  const engine = new AutonomyEngine({ offerThreshold: 10, spotCheckRate: 0 });
  engine.onEvent((e) => events.push(e.type));

  for (let i = 0; i < 1_000_000; i += 1) {
    engine.recordApproval("tenant-a", "payments", ["money-movement"]);
  }

  assert.deepEqual(events, []);
  assert.equal(engine.isActive("tenant-a", "payments"), false);
});

test("each deny-list tag independently blocks offers", () => {
  const deniedTags = ["money-movement", "external-send-high-stakes", "deploy", "requires-professional-verification", "never-autonomous"];
  for (const tag of deniedTags) {
    const engine = new AutonomyEngine({ offerThreshold: 1, spotCheckRate: 0 });
    let offered = false;
    engine.onEvent((e) => { if (e.type === "autonomy.offered") offered = true; });
    engine.recordApproval("tenant-a", "some-task", [tag]);
    assert.equal(offered, false, `tag "${tag}" should have blocked the offer`);
  }
});

test("a normal rejection resets the counter but does not revoke already-active autonomy", () => {
  const engine = new AutonomyEngine({ offerThreshold: 2, spotCheckRate: 0 });
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.acceptOffer("tenant-a", "invoicing");
  assert.equal(engine.isActive("tenant-a", "invoicing"), true);

  engine.recordRejection("tenant-a", "invoicing");
  assert.equal(engine.isActive("tenant-a", "invoicing"), true, "normal reject must not revoke active autonomy");
  assert.equal(engine.stateFor("tenant-a", "invoicing").consecutiveApprovals, 0);
});

test("a rejection before reaching threshold resets progress toward the offer", () => {
  const engine = new AutonomyEngine({ offerThreshold: 5, spotCheckRate: 0 });
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.recordRejection("tenant-a", "invoicing");
  assert.equal(engine.stateFor("tenant-a", "invoicing").consecutiveApprovals, 0);
});

test("spot-check rejection auto-revokes active autonomy", () => {
  const events: string[] = [];
  const engine = new AutonomyEngine({ offerThreshold: 2, spotCheckRate: 0 });
  engine.onEvent((e) => events.push(e.type));
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.acceptOffer("tenant-a", "invoicing");

  engine.recordSpotCheckRejection("tenant-a", "invoicing");
  assert.equal(engine.isActive("tenant-a", "invoicing"), false);
  assert.ok(events.includes("autonomy.revoked"));
});

test("sampler is deterministic given an injected RNG", () => {
  let callIndex = 0;
  const scripted = [0.05, 0.5, 0.05, 0.99]; // < 0.1 => spot-check, else bypass
  const engine = new AutonomyEngine({ offerThreshold: 1, spotCheckRate: 0.1 }, () => scripted[callIndex++]);

  assert.equal(engine.shouldSpotCheck(), true); // 0.05 < 0.1
  assert.equal(engine.shouldSpotCheck(), false); // 0.5 >= 0.1
  assert.equal(engine.shouldSpotCheck(), true); // 0.05 < 0.1
  assert.equal(engine.shouldSpotCheck(), false); // 0.99 >= 0.1
});

test("revoke(tenantId, taskType): revokes exactly that task type, leaves others untouched", () => {
  const engine = new AutonomyEngine({ offerThreshold: 1, spotCheckRate: 0 });
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.acceptOffer("tenant-a", "invoicing");
  engine.recordApproval("tenant-a", "triage", []);
  engine.acceptOffer("tenant-a", "triage");

  engine.revoke("tenant-a", "invoicing");
  assert.equal(engine.isActive("tenant-a", "invoicing"), false);
  assert.equal(engine.isActive("tenant-a", "triage"), true);
});

test("revoke(tenantId): revokes every active task type for that tenant, and only that tenant", () => {
  const engine = new AutonomyEngine({ offerThreshold: 1, spotCheckRate: 0 });
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.acceptOffer("tenant-a", "invoicing");
  engine.recordApproval("tenant-a", "triage", []);
  engine.acceptOffer("tenant-a", "triage");
  engine.recordApproval("tenant-b", "invoicing", []);
  engine.acceptOffer("tenant-b", "invoicing");

  engine.revoke("tenant-a");
  assert.equal(engine.isActive("tenant-a", "invoicing"), false);
  assert.equal(engine.isActive("tenant-a", "triage"), false);
  assert.equal(engine.isActive("tenant-b", "invoicing"), true, "revoking tenant-a must not touch tenant-b");
});

test("per (tenant, task-type) isolation: same task type, different tenants, independent counters", () => {
  const engine = new AutonomyEngine({ offerThreshold: 3, spotCheckRate: 0 });
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.recordApproval("tenant-a", "invoicing", []);
  engine.recordApproval("tenant-b", "invoicing", []);

  assert.equal(engine.stateFor("tenant-a", "invoicing").consecutiveApprovals, 2);
  assert.equal(engine.stateFor("tenant-b", "invoicing").consecutiveApprovals, 1);
});
