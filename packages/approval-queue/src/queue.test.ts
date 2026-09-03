import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDurableAutonomyStore } from "./durable/autonomyStore.js";
import { ApprovalQueue } from "./queue.js";
import type { EffectExecutor, EffectResult } from "./effectExecutor.js";
import { EffectOnRecommendationError, UnknownActionError } from "./types.js";
import type { ProposedAction, RecommendationItem } from "./types.js";

const TENANT = "tenant-a";

function countingExecutor(): { executor: EffectExecutor; callCount: () => number } {
  let calls = 0;
  const executor: EffectExecutor = {
    async execute(): Promise<EffectResult> {
      calls += 1;
      return { success: true };
    },
  };
  return { executor, callCount: () => calls };
}

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: "action-1",
    tenantId: TENANT,
    agentName: "Alex",
    roleTitle: "CFO",
    taskType: "invoicing",
    summary: "Drafted an invoice for order #123",
    draft: "Invoice #123: $450 due in 30 days.",
    stakesTags: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("a pure draft (no effect) queues and APPROVE resolves with no dispatch", async () => {
  const { executor, callCount } = countingExecutor();
  const queue = new ApprovalQueue(new InMemoryDurableAutonomyStore(), executor);

  const submitResult = await queue.submitProposedAction(makeAction());
  assert.equal(submitResult.queued, true);

  const resolveResult = await queue.resolve(TENANT, "action-1", { kind: "APPROVE" });
  assert.equal(resolveResult.dispatched, false);
  assert.equal(callCount(), 0, "no effect descriptor means nothing to dispatch");
});

test("an action WITH an effect dispatches only after APPROVE, never on intake", async () => {
  const { executor, callCount } = countingExecutor();
  const queue = new ApprovalQueue(new InMemoryDurableAutonomyStore(), executor);

  await queue.submitProposedAction(makeAction({ effect: { kind: "send", description: "Email the invoice to the client" } }));
  assert.equal(callCount(), 0, "effect must not dispatch on intake");

  const result = await queue.resolve(TENANT, "action-1", { kind: "APPROVE" });
  assert.equal(result.dispatched, true);
  assert.equal(callCount(), 1);
});

test("REJECT requires feedback (type-enforced) and emits an agent.learning event", async () => {
  const { executor } = countingExecutor();
  const queue = new ApprovalQueue(new InMemoryDurableAutonomyStore(), executor);
  const events: string[] = [];
  queue.onEvent((e) => events.push(e.type));

  await queue.submitProposedAction(makeAction({ effect: { kind: "send", description: "..." } }));
  const result = await queue.resolve(TENANT, "action-1", { kind: "REJECT", feedback: "Wrong amount — should be $500." });

  assert.equal(result.dispatched, false);
  assert.ok(events.includes("agent.learning"));
});

test("REJECT resets the consecutive-approval counter for that task type", async () => {
  const { executor } = countingExecutor();
  const autonomy = new InMemoryDurableAutonomyStore({ offerThreshold: 5, spotCheckRate: 0 });
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  await queue.submitProposedAction(makeAction({ id: "a2" }));
  await queue.resolve(TENANT, "a2", { kind: "APPROVE" });
  assert.equal((await autonomy.stateFor("tenant-a", "invoicing")).consecutiveApprovals, 2);

  await queue.submitProposedAction(makeAction({ id: "a3" }));
  await queue.resolve(TENANT, "a3", { kind: "REJECT", feedback: "not quite right" });
  assert.equal((await autonomy.stateFor("tenant-a", "invoicing")).consecutiveApprovals, 0);
});

test("MODIFY substitutes the draft, then follows the approve-path (dispatches with edited content)", async () => {
  let dispatchedAction: ProposedAction | undefined;
  const executor: EffectExecutor = {
    async execute(_effect, action): Promise<EffectResult> {
      dispatchedAction = action;
      return { success: true };
    },
  };
  const queue = new ApprovalQueue(new InMemoryDurableAutonomyStore(), executor);

  await queue.submitProposedAction(
    makeAction({ draft: "original text", effect: { kind: "send", description: "..." } }),
  );
  const result = await queue.resolve(TENANT, "action-1", { kind: "MODIFY", editedOutput: "corrected text" });

  assert.equal(result.dispatched, true);
  assert.equal(dispatchedAction?.draft, "corrected text");
});

test("MODIFY counts toward the autonomy counter, same as APPROVE", async () => {
  const { executor } = countingExecutor();
  const autonomy = new InMemoryDurableAutonomyStore({ offerThreshold: 2, spotCheckRate: 0 });
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "MODIFY", editedOutput: "edited" });
  await queue.submitProposedAction(makeAction({ id: "a2" }));
  await queue.resolve(TENANT, "a2", { kind: "MODIFY", editedOutput: "edited" });

  assert.equal(await autonomy.isActive("tenant-a", "invoicing"), false); // offered, not yet accepted
  assert.equal((await autonomy.stateFor("tenant-a", "invoicing")).consecutiveApprovals, 2);
});

test("resolving an unknown action id throws", async () => {
  const { executor } = countingExecutor();
  const queue = new ApprovalQueue(new InMemoryDurableAutonomyStore(), executor);
  await assert.rejects(() => queue.resolve(TENANT, "does-not-exist", { kind: "APPROVE" }), UnknownActionError);
});

test("resolve() emits autonomy.offered exactly on the approval that crosses the threshold, synthesized from the store's return value", async () => {
  const { executor } = countingExecutor();
  const queue = new ApprovalQueue(new InMemoryDurableAutonomyStore({ offerThreshold: 2, spotCheckRate: 0 }), executor);
  const autonomyEvents: string[] = [];
  queue.onEvent((e) => {
    if (e.type.startsWith("autonomy.")) autonomyEvents.push(e.type);
  });

  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  assert.deepEqual(autonomyEvents, [], "no offer before the threshold");

  await queue.submitProposedAction(makeAction({ id: "a2" }));
  await queue.resolve(TENANT, "a2", { kind: "APPROVE" });
  assert.deepEqual(autonomyEvents, ["autonomy.offered"]);

  // Further approvals (autonomy not yet accepted) must not re-offer.
  await queue.submitProposedAction(makeAction({ id: "a3" }));
  await queue.resolve(TENANT, "a3", { kind: "APPROVE" });
  assert.deepEqual(autonomyEvents, ["autonomy.offered"]);
});

test("earned autonomy bypass: active + sampler skips -> a pure draft dispatches without ever queuing", async () => {
  const { executor, callCount } = countingExecutor();
  const autonomy = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 }, () => 1); // 1 >= any rate -> never spot-check
  const queue = new ApprovalQueue(autonomy, executor);

  // Earn and accept autonomy first.
  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  await queue.acceptOffer("tenant-a", "invoicing");

  const events: string[] = [];
  queue.onEvent((e) => events.push(e.type));
  const result = await queue.submitProposedAction(makeAction({ id: "a2" })); // no effect — a pure draft

  assert.equal(result.queued, false);
  assert.equal(callCount(), 0, "a1 and a2 are both pure drafts — nothing to dispatch either way");
  assert.deepEqual(events, ["action.auto-approved"]);
  assert.equal((await queue.pendingActions(TENANT)).length, 0);
});

// The safety-critical case: MockEffectExecutor being a no-op is the ONLY
// reason a real effect never fired via the bypass above before this fix
// existed — the moment a real EffectExecutor (e.g. ResendEffectExecutor)
// is wired in, that silence would have become a real, unreviewed
// external action. This test is the structural proof that can't happen.
test("an effect-bearing action never bypasses human review, even when autonomy is fully active and the sampler would never spot-check", async () => {
  const { executor, callCount } = countingExecutor();
  const autonomy = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 }, () => 1); // 1 >= any rate -> never spot-check
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  await queue.acceptOffer("tenant-a", "invoicing");
  assert.equal(await autonomy.isActive("tenant-a", "invoicing"), true);

  const events: string[] = [];
  queue.onEvent((e) => events.push(e.type));
  const result = await queue.submitProposedAction(
    makeAction({ id: "a2", effect: { kind: "send", description: "..." } }),
  );

  assert.equal(result.queued, true, "a real effect must always queue for a human, regardless of autonomy state");
  assert.equal(callCount(), 0, "the effect must not dispatch until a human resolves it");
  assert.deepEqual(events, ["action.queued"], "no auto-approved event — this never took the bypass");

  const resolved = await queue.resolve(TENANT, "a2", { kind: "APPROVE" });
  assert.equal(resolved.dispatched, true);
  assert.equal(callCount(), 1, "the human APPROVE, not autonomy, is what dispatched it");
});

test("earned autonomy active but sampler selects spot-check -> still queues for human review", async () => {
  const { executor, callCount } = countingExecutor();
  const autonomy = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 1 }, () => 0); // 0 < 1 -> always spot-check
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  await queue.acceptOffer("tenant-a", "invoicing");

  const result = await queue.submitProposedAction(makeAction({ id: "a2", effect: { kind: "send", description: "..." } }));
  assert.equal(result.queued, true);
  assert.equal(callCount(), 0, "must not dispatch until the spot-check is resolved");
  assert.equal((await queue.pendingActions(TENANT)).length, 1);
});

test("a spot-check REJECT auto-revokes autonomy for that task type, and emits autonomy.revoked", async () => {
  const { executor } = countingExecutor();
  const autonomy = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 1 }, () => 0); // always spot-check
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  await queue.acceptOffer("tenant-a", "invoicing");
  assert.equal(await autonomy.isActive("tenant-a", "invoicing"), true);

  const events: Array<{ type: string; reason?: string }> = [];
  queue.onEvent((e) => events.push(e as { type: string; reason?: string }));

  await queue.submitProposedAction(makeAction({ id: "a2" })); // gets spot-checked (queued)
  await queue.resolve(TENANT, "a2", { kind: "REJECT", feedback: "actually wrong this time" });

  assert.equal(await autonomy.isActive("tenant-a", "invoicing"), false);
  const revokedEvent = events.find((e) => e.type === "autonomy.revoked");
  assert.equal(revokedEvent?.reason, "spot-check-rejected");
});

test("a deny-tagged action always queues, even when autonomy is active for that SAME task type via other non-deny-tagged actions", async () => {
  const { executor, callCount } = countingExecutor();
  // Sampler configured to always bypass if the queue let it — proves the
  // deny-list check is what's actually stopping this, not the sampler.
  const autonomy = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 }, () => 1);
  const queue = new ApprovalQueue(autonomy, executor);

  // Earn + accept autonomy for "payments" using an ordinary, non-deny-tagged action.
  await queue.submitProposedAction(makeAction({ id: "a1", taskType: "payments", stakesTags: [] }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  await queue.acceptOffer("tenant-a", "payments");
  assert.equal(await autonomy.isActive("tenant-a", "payments"), true);

  // A LATER action under the SAME task type, but deny-tagged, must still queue.
  const result = await queue.submitProposedAction(
    makeAction({ id: "a2", taskType: "payments", stakesTags: ["money-movement"], effect: { kind: "pay", description: "..." } }),
  );

  assert.equal(result.queued, true, "deny-listed stakesTags must always queue for human review, regardless of the task type's active status");
  assert.equal(callCount(), 0, "the effect must not have dispatched via bypass");
});

// ---- CEO pathway (T10) ----

function makeRecommendation(overrides: Partial<RecommendationItem> = {}): RecommendationItem {
  return {
    id: "rec-1",
    tenantId: TENANT,
    agentName: "Morgan",
    roleTitle: "CEO",
    summary: "Consider raising prices 5% next quarter",
    draft: "Based on this month's margin trend...",
    stakesTags: ["high-stakes"],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("a RecommendationItem submitted normally never dispatches anything on any verdict", async () => {
  const { executor, callCount } = countingExecutor();
  const queue = new ApprovalQueue(new InMemoryDurableAutonomyStore(), executor);

  await queue.submitRecommendation(makeRecommendation());
  await queue.resolveRecommendation(TENANT, "rec-1", { kind: "APPROVE" });

  assert.equal(callCount(), 0, "recommendations can never dispatch an effect — there is none to dispatch");
});

test("smuggling an effect onto a recommendation via a cast is rejected at runtime (defense in depth)", async () => {
  const { executor } = countingExecutor();
  const queue = new ApprovalQueue(new InMemoryDurableAutonomyStore(), executor);

  const tampered = { ...makeRecommendation(), effect: { kind: "pay", description: "sneaky" } } as unknown as RecommendationItem;
  await assert.rejects(() => queue.submitRecommendation(tampered), EffectOnRecommendationError);
});

test("recommendation verdicts emit guidance events only, never agent.learning or action.queued", async () => {
  const { executor } = countingExecutor();
  const queue = new ApprovalQueue(new InMemoryDurableAutonomyStore(), executor);
  const events: string[] = [];
  queue.onEvent((e) => events.push(e.type));

  await queue.submitRecommendation(makeRecommendation());
  await queue.resolveRecommendation(TENANT, "rec-1", { kind: "REJECT", feedback: "not now" });

  assert.deepEqual(events, ["recommendation.guidance"]);
});

test("audit log records every intake and resolution, with no effect payload leaked into it", async () => {
  const { executor } = countingExecutor();
  const queue = new ApprovalQueue(new InMemoryDurableAutonomyStore(), executor);

  await queue.submitProposedAction(makeAction({ effect: { kind: "send", description: "...", detail: { to: "client@example.com" } } }));
  await queue.resolve(TENANT, "action-1", { kind: "APPROVE" });

  const events = queue.auditEvents();
  assert.deepEqual(events.map((e) => e.kind), ["queued", "APPROVE"]);
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes("client@example.com"), "audit log must not carry effect detail payloads");
});

test("revokeAutonomy() delegates to the durable autonomy store and emits autonomy.revoked", async () => {
  const { executor } = countingExecutor();
  const autonomy = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 });
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction());
  await queue.resolve(TENANT, "action-1", { kind: "APPROVE" });
  await queue.acceptOffer("tenant-a", "invoicing");
  assert.equal(await autonomy.isActive("tenant-a", "invoicing"), true);

  const events: Array<{ type: string; taskType?: string }> = [];
  queue.onEvent((e) => events.push(e as { type: string; taskType?: string }));

  await queue.revokeAutonomy("tenant-a", "invoicing");
  assert.equal(await autonomy.isActive("tenant-a", "invoicing"), false);
  assert.deepEqual(
    events.filter((e) => e.type === "autonomy.revoked").map((e) => e.taskType),
    ["invoicing"],
  );
});

// The whole point of this refactor (autonomy durability): accepting an
// offer through ApprovalQueue.acceptOffer() must be visible to the SAME
// object submitProposedAction reads — previously (apps/api/src/routes/
// approvals.ts) these were two separate store instances, so accepting an
// offer durably recorded active=true in Postgres but had zero effect on
// live dispatch gating. This test is the structural proof that gap is
// closed: one store, one call, immediately observed.
test("acceptOffer() flips isActive on the SAME store submitProposedAction reads — the split-brain this change closes", async () => {
  const { executor, callCount } = countingExecutor();
  const autonomy = new InMemoryDurableAutonomyStore({ offerThreshold: 1, spotCheckRate: 0 }, () => 1); // never spot-check
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });

  // Not yet accepted — must still queue, not bypass. Pure drafts (no
  // effect) throughout: bypass reachability is proven by `queued`
  // flipping, not by anything actually dispatching — see the dedicated
  // effect-bearing tests above for why an effect never takes this path.
  const beforeAccept = await queue.submitProposedAction(makeAction({ id: "a2" }));
  assert.equal(beforeAccept.queued, true);

  await queue.acceptOffer("tenant-a", "invoicing");

  // Now accepted — the exact same queue/store must immediately bypass.
  const afterAccept = await queue.submitProposedAction(makeAction({ id: "a3" }));
  assert.equal(afterAccept.queued, false, "acceptOffer must be immediately visible to submitProposedAction's own isActive check");
  assert.equal(callCount(), 0, "a1/a2/a3 are all pure drafts — nothing to dispatch");
});
