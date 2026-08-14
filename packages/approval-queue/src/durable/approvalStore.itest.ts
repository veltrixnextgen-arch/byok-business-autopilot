// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// Run via `npm run test:integration` (packages/approval-queue), never as
// part of the regular `npm test`. Locally: `docker compose up -d` then
// `npm run db:migrate` from repo root. In CI: a Postgres service
// container, migrated before this runs — see .github/workflows/ci.yml.
//
// ADR-026: PostgresDurableApprovalStore existed, fully built and exported,
// with zero coverage against a real Postgres anywhere in this repo before
// this file — it was wired into nothing. This is that missing coverage,
// written before wiring it into the live staging path, not after.
import { createPool, PostgresDurableAuditLog } from "@byok/db";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { UnknownActionError, UnknownRecommendationError, type ProposedAction, type RecommendationItem } from "../types.js";
import { PostgresDurableApprovalStore } from "./approvalStore.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required for the integration suite. Start the local stack (`docker compose up -d`), run " +
      "`npm run db:migrate`, then set DATABASE_URL — or run via `npm run test:integration` in CI, where the " +
      "workflow migrates a Postgres service container before this runs.",
  );
}

const pool = createPool({ connectionString: DATABASE_URL, max: 20 });

function makeAction(tenantId: string, overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: randomUUID(),
    tenantId,
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

function makeRecommendation(tenantId: string, overrides: Partial<RecommendationItem> = {}): RecommendationItem {
  return {
    id: randomUUID(),
    tenantId,
    agentName: "Morgan",
    roleTitle: "CEO",
    summary: "Consider raising prices 5% next quarter",
    draft: "Based on this month's margin trend...",
    stakesTags: ["high-stakes"],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("submitProposedAction persists a real row, visible via pendingActions on a fresh read", async () => {
  const tenantId = randomUUID();
  const store = new PostgresDurableApprovalStore(pool);
  const action = makeAction(tenantId);

  await store.submitProposedAction(action, false);

  const pending = await store.pendingActions(tenantId);
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0], action);
});

test("resolve() marks the row resolved (no longer pending) and returns the action plus its stored spot-check flag", async () => {
  const tenantId = randomUUID();
  const store = new PostgresDurableApprovalStore(pool);
  const action = makeAction(tenantId);

  await store.submitProposedAction(action, true);
  const outcome = await store.resolve(tenantId, action.id, { kind: "APPROVE" });

  assert.deepEqual(outcome.action, action);
  assert.equal(outcome.wasSpotCheck, true);
  assert.deepEqual(await store.pendingActions(tenantId), []);
});

test("resolve() is atomic against a repeat call — the second resolve on the same id throws, never double-resolves", async () => {
  const tenantId = randomUUID();
  const store = new PostgresDurableApprovalStore(pool);
  const action = makeAction(tenantId);

  await store.submitProposedAction(action, false);
  await store.resolve(tenantId, action.id, { kind: "APPROVE" });

  await assert.rejects(() => store.resolve(tenantId, action.id, { kind: "APPROVE" }), UnknownActionError);
});

test("resolve() on an unknown id throws", async () => {
  const tenantId = randomUUID();
  const store = new PostgresDurableApprovalStore(pool);
  await assert.rejects(() => store.resolve(tenantId, randomUUID(), { kind: "APPROVE" }), UnknownActionError);
});

test("submitRecommendation persists a real row, visible via pendingRecommendations on a fresh read", async () => {
  const tenantId = randomUUID();
  const store = new PostgresDurableApprovalStore(pool);
  const item = makeRecommendation(tenantId);

  await store.submitRecommendation(item);

  const pending = await store.pendingRecommendations(tenantId);
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0], item);
});

test("resolveRecommendation() marks the row resolved and returns the item; a repeat call throws", async () => {
  const tenantId = randomUUID();
  const store = new PostgresDurableApprovalStore(pool);
  const item = makeRecommendation(tenantId);

  await store.submitRecommendation(item);
  const resolved = await store.resolveRecommendation(tenantId, item.id);

  assert.deepEqual(resolved, item);
  assert.deepEqual(await store.pendingRecommendations(tenantId), []);
  await assert.rejects(() => store.resolveRecommendation(tenantId, item.id), UnknownRecommendationError);
});

test("RLS: a session scoped to a different tenant cannot see another tenant's pending actions or recommendations", async () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const store = new PostgresDurableApprovalStore(pool);

  await store.submitProposedAction(makeAction(tenantA), false);
  await store.submitRecommendation(makeRecommendation(tenantA));

  assert.deepEqual(await store.pendingActions(tenantB), [], "tenant B must not see tenant A's proposed actions");
  assert.deepEqual(await store.pendingRecommendations(tenantB), [], "tenant B must not see tenant A's recommendations");
});

// This is the exact mechanism GET /dashboard's recentActivity reads
// (apps/router/src/durable/queries.ts's PostgresCostActivityQueries,
// against audit_log) — proving a queued item is durably reflected there,
// not just in approval_queue_items itself.
test("submitProposedAction and resolve() both write a real audit_log row when constructed with an audit sink", async () => {
  const tenantId = randomUUID();
  const audit = new PostgresDurableAuditLog(pool);
  const store = new PostgresDurableApprovalStore(pool, audit);
  const action = makeAction(tenantId);

  await store.submitProposedAction(action, false);
  await store.resolve(tenantId, action.id, { kind: "APPROVE" });

  const events = await audit.recentForTenant(tenantId);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["APPROVE", "queued"],
    "newest first — resolve's audit row was written after submitProposedAction's",
  );
  assert.ok(events.every((e) => e.source === "approval-queue"));
});
