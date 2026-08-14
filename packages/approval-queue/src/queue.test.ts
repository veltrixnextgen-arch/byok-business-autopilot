import { test } from "node:test";
import assert from "node:assert/strict";
import { AutonomyEngine } from "./autonomyEngine.js";
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
  const queue = new ApprovalQueue(new AutonomyEngine(), executor);

  const submitResult = await queue.submitProposedAction(makeAction());
  assert.equal(submitResult.queued, true);

  const resolveResult = await queue.resolve(TENANT, "action-1", { kind: "APPROVE" });
  assert.equal(resolveResult.dispatched, false);
  assert.equal(callCount(), 0, "no effect descriptor means nothing to dispatch");
});

test("an action WITH an effect dispatches only after APPROVE, never on intake", async () => {
  const { executor, callCount } = countingExecutor();
  const queue = new ApprovalQueue(new AutonomyEngine(), executor);

  await queue.submitProposedAction(makeAction({ effect: { kind: "send", description: "Email the invoice to the client" } }));
  assert.equal(callCount(), 0, "effect must not dispatch on intake");

  const result = await queue.resolve(TENANT, "action-1", { kind: "APPROVE" });
  assert.equal(result.dispatched, true);
  assert.equal(callCount(), 1);
});

test("REJECT requires feedback (type-enforced) and emits an agent.learning event", async () => {
  const { executor } = countingExecutor();
  const queue = new ApprovalQueue(new AutonomyEngine(), executor);
  const events: string[] = [];
  queue.onEvent((e) => events.push(e.type));

  await queue.submitProposedAction(makeAction({ effect: { kind: "send", description: "..." } }));
  const result = await queue.resolve(TENANT, "action-1", { kind: "REJECT", feedback: "Wrong amount — should be $500." });

  assert.equal(result.dispatched, false);
  assert.ok(events.includes("agent.learning"));
});

test("REJECT resets the consecutive-approval counter for that task type", async () => {
  const { executor } = countingExecutor();
  const autonomy = new AutonomyEngine({ offerThreshold: 5, spotCheckRate: 0 });
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  await queue.submitProposedAction(makeAction({ id: "a2" }));
  await queue.resolve(TENANT, "a2", { kind: "APPROVE" });
  assert.equal(autonomy.stateFor("tenant-a", "invoicing").consecutiveApprovals, 2);

  await queue.submitProposedAction(makeAction({ id: "a3" }));
  await queue.resolve(TENANT, "a3", { kind: "REJECT", feedback: "not quite right" });
  assert.equal(autonomy.stateFor("tenant-a", "invoicing").consecutiveApprovals, 0);
});

test("MODIFY substitutes the draft, then follows the approve-path (dispatches with edited content)", async () => {
  let dispatchedAction: ProposedAction | undefined;
  const executor: EffectExecutor = {
    async execute(_effect, action): Promise<EffectResult> {
      dispatchedAction = action;
      return { success: true };
    },
  };
  const queue = new ApprovalQueue(new AutonomyEngine(), executor);

  await queue.submitProposedAction(
    makeAction({ draft: "original text", effect: { kind: "send", description: "..." } }),
  );
  const result = await queue.resolve(TENANT, "action-1", { kind: "MODIFY", editedOutput: "corrected text" });

  assert.equal(result.dispatched, true);
  assert.equal(dispatchedAction?.draft, "corrected text");
});

test("MODIFY counts toward the autonomy counter, same as APPROVE", async () => {
  const { executor } = countingExecutor();
  const autonomy = new AutonomyEngine({ offerThreshold: 2, spotCheckRate: 0 });
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "MODIFY", editedOutput: "edited" });
  await queue.submitProposedAction(makeAction({ id: "a2" }));
  await queue.resolve(TENANT, "a2", { kind: "MODIFY", editedOutput: "edited" });

  assert.equal(autonomy.isActive("tenant-a", "invoicing"), false); // offered, not yet accepted
  assert.equal(autonomy.stateFor("tenant-a", "invoicing").consecutiveApprovals, 2);
});

test("resolving an unknown action id throws", async () => {
  const { executor } = countingExecutor();
  const queue = new ApprovalQueue(new AutonomyEngine(), executor);
  await assert.rejects(() => queue.resolve(TENANT, "does-not-exist", { kind: "APPROVE" }), UnknownActionError);
});

test("earned autonomy bypass: active + sampler skips -> dispatches without ever queuing", async () => {
  const { executor, callCount } = countingExecutor();
  const autonomy = new AutonomyEngine({ offerThreshold: 1, spotCheckRate: 0 }, () => 1); // 1 >= any rate -> never spot-check
  const queue = new ApprovalQueue(autonomy, executor);

  // Earn and accept autonomy first.
  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  autonomy.acceptOffer("tenant-a", "invoicing");

  const events: string[] = [];
  queue.onEvent((e) => events.push(e.type));
  const result = await queue.submitProposedAction(
    makeAction({ id: "a2", effect: { kind: "send", description: "..." } }),
  );

  assert.equal(result.queued, false);
  assert.equal(callCount(), 1, "a1 had no effect (never dispatches); only a2's bypass dispatches"); // a1 had no effect, only a2 dispatches
  assert.deepEqual(events, ["action.auto-approved"]);
  assert.equal((await queue.pendingActions(TENANT)).length, 0);
});

test("earned autonomy active but sampler selects spot-check -> still queues for human review", async () => {
  const { executor, callCount } = countingExecutor();
  const autonomy = new AutonomyEngine({ offerThreshold: 1, spotCheckRate: 1 }, () => 0); // 0 < 1 -> always spot-check
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  autonomy.acceptOffer("tenant-a", "invoicing");

  const result = await queue.submitProposedAction(makeAction({ id: "a2", effect: { kind: "send", description: "..." } }));
  assert.equal(result.queued, true);
  assert.equal(callCount(), 0, "must not dispatch until the spot-check is resolved");
  assert.equal((await queue.pendingActions(TENANT)).length, 1);
});

test("a spot-check REJECT auto-revokes autonomy for that task type", async () => {
  const { executor } = countingExecutor();
  const autonomy = new AutonomyEngine({ offerThreshold: 1, spotCheckRate: 1 }, () => 0); // always spot-check
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction({ id: "a1" }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  autonomy.acceptOffer("tenant-a", "invoicing");
  assert.equal(autonomy.isActive("tenant-a", "invoicing"), true);

  await queue.submitProposedAction(makeAction({ id: "a2" })); // gets spot-checked (queued)
  await queue.resolve(TENANT, "a2", { kind: "REJECT", feedback: "actually wrong this time" });

  assert.equal(autonomy.isActive("tenant-a", "invoicing"), false);
});

test("a deny-tagged action always queues, even when autonomy is active for that SAME task type via other non-deny-tagged actions", async () => {
  const { executor, callCount } = countingExecutor();
  // Sampler configured to always bypass if the queue let it — proves the
  // deny-list check is what's actually stopping this, not the sampler.
  const autonomy = new AutonomyEngine({ offerThreshold: 1, spotCheckRate: 0 }, () => 1);
  const queue = new ApprovalQueue(autonomy, executor);

  // Earn + accept autonomy for "payments" using an ordinary, non-deny-tagged action.
  await queue.submitProposedAction(makeAction({ id: "a1", taskType: "payments", stakesTags: [] }));
  await queue.resolve(TENANT, "a1", { kind: "APPROVE" });
  autonomy.acceptOffer("tenant-a", "payments");
  assert.equal(autonomy.isActive("tenant-a", "payments"), true);

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
  const queue = new ApprovalQueue(new AutonomyEngine(), executor);

  await queue.submitRecommendation(makeRecommendation());
  await queue.resolveRecommendation(TENANT, "rec-1", { kind: "APPROVE" });

  assert.equal(callCount(), 0, "recommendations can never dispatch an effect — there is none to dispatch");
});

test("smuggling an effect onto a recommendation via a cast is rejected at runtime (defense in depth)", async () => {
  const { executor } = countingExecutor();
  const queue = new ApprovalQueue(new AutonomyEngine(), executor);

  const tampered = { ...makeRecommendation(), effect: { kind: "pay", description: "sneaky" } } as unknown as RecommendationItem;
  await assert.rejects(() => queue.submitRecommendation(tampered), EffectOnRecommendationError);
});

test("recommendation verdicts emit guidance events only, never agent.learning or action.queued", async () => {
  const { executor } = countingExecutor();
  const queue = new ApprovalQueue(new AutonomyEngine(), executor);
  const events: string[] = [];
  queue.onEvent((e) => events.push(e.type));

  await queue.submitRecommendation(makeRecommendation());
  await queue.resolveRecommendation(TENANT, "rec-1", { kind: "REJECT", feedback: "not now" });

  assert.deepEqual(events, ["recommendation.guidance"]);
});

test("audit log records every intake and resolution, with no effect payload leaked into it", async () => {
  const { executor } = countingExecutor();
  const queue = new ApprovalQueue(new AutonomyEngine(), executor);

  await queue.submitProposedAction(makeAction({ effect: { kind: "send", description: "...", detail: { to: "client@example.com" } } }));
  await queue.resolve(TENANT, "action-1", { kind: "APPROVE" });

  const events = queue.auditEvents();
  assert.deepEqual(events.map((e) => e.kind), ["queued", "APPROVE"]);
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes("client@example.com"), "audit log must not carry effect detail payloads");
});

test("revokeAutonomy() delegates to the autonomy engine", async () => {
  const { executor } = countingExecutor();
  const autonomy = new AutonomyEngine({ offerThreshold: 1, spotCheckRate: 0 });
  const queue = new ApprovalQueue(autonomy, executor);

  await queue.submitProposedAction(makeAction());
  await queue.resolve(TENANT, "action-1", { kind: "APPROVE" });
  autonomy.acceptOffer("tenant-a", "invoicing");
  assert.equal(autonomy.isActive("tenant-a", "invoicing"), true);

  queue.revokeAutonomy("tenant-a", "invoicing");
  assert.equal(autonomy.isActive("tenant-a", "invoicing"), false);
});
