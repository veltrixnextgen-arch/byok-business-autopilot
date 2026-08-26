import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { ProposedAction, RecommendationItem } from "@byok/approval-queue";
import { UnknownActionError, UnknownRecommendationError } from "@byok/approval-queue";
import type { AppEnv, AppSession } from "../context.js";
import { approvalsRoute, type ApprovalsRouteDeps } from "./approvals.js";

const SESSION = { user: { id: "user-1", email: "founder@example.com" }, session: {} } as never;

function appWithSession(tenantId: string, session: AppSession, deps: ApprovalsRouteDeps) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", approvalsRoute(deps));
}

const ACTION: ProposedAction = {
  id: "action-1",
  tenantId: "tenant-1",
  agentName: "Sam",
  roleTitle: "Expenses",
  taskType: "agent-1",
  summary: "Categorize expenses",
  draft: "Categorized 12 transactions.",
  stakesTags: [],
  createdAt: "2026-08-20T00:00:00.000Z",
};

const RECOMMENDATION: RecommendationItem = {
  id: "rec-1",
  tenantId: "tenant-1",
  agentName: "Jordan",
  roleTitle: "CEO",
  summary: "Weekly plan",
  draft: "Focus on retention this week.",
  stakesTags: [],
  createdAt: "2026-08-20T01:00:00.000Z",
};

function fakeDeps(overrides: Partial<Omit<ApprovalsRouteDeps, "approvalQueue">> & { approvalQueue?: Partial<ApprovalsRouteDeps["approvalQueue"]> } = {}): ApprovalsRouteDeps {
  return {
    ...overrides,
    approvalQueue: {
      pendingActions: async () => [ACTION],
      pendingRecommendationItems: async () => [RECOMMENDATION],
      resolve: async () => ({ dispatched: false }),
      resolveRecommendation: async () => {},
      acceptOffer: async () => {},
      ...overrides.approvalQueue,
    },
    costActivity: {
      costByRefIds: async () => ({}),
      autonomyStatus: async () => [],
    },
  };
}

test("GET / returns the merged real queue and autonomy status", async () => {
  const app = appWithSession("tenant-1", SESSION, fakeDeps());
  const res = await app.request("/");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: unknown[] };
  assert.equal(body.items.length, 2);
});

test("GET /count returns the real pending count, actions plus recommendations", async () => {
  const app = appWithSession("tenant-1", SESSION, fakeDeps());
  const res = await app.request("/count");
  const body = (await res.json()) as { count: number };
  assert.equal(body.count, 2);
});

test("POST /:id/resolve APPROVE calls approvalQueue.resolve for an action", async () => {
  let called: [string, string, unknown] | undefined;
  const deps = fakeDeps({
    approvalQueue: {
      ...fakeDeps().approvalQueue,
      resolve: async (tenantId, id, verdict) => {
        called = [tenantId, id, verdict];
        return { dispatched: true };
      },
    },
  });
  const app = appWithSession("tenant-1", SESSION, deps);
  const res = await app.request("/action-1/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "action", verdict: { kind: "APPROVE" } }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(called, ["tenant-1", "action-1", { kind: "APPROVE" }]);
  const body = (await res.json()) as { dispatched: boolean };
  assert.equal(body.dispatched, true);
});

test("POST /:id/resolve REJECT requires feedback — rejected by the schema before reaching the store", async () => {
  const app = appWithSession("tenant-1", SESSION, fakeDeps());
  const res = await app.request("/action-1/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "action", verdict: { kind: "REJECT", feedback: "" } }),
  });
  assert.equal(res.status, 400);
});

test("POST /:id/resolve MODIFY on a recommendation is rejected — recommendations never dispatch anything to modify", async () => {
  const app = appWithSession("tenant-1", SESSION, fakeDeps());
  const res = await app.request("/rec-1/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "recommendation", verdict: { kind: "MODIFY", editedOutput: "edited" } }),
  });
  assert.equal(res.status, 400);
});

test("POST /:id/resolve calls resolveRecommendation for a recommendation, never resolve", async () => {
  let recommendationCalled = false;
  let actionCalled = false;
  const deps = fakeDeps({
    approvalQueue: {
      ...fakeDeps().approvalQueue,
      resolve: async () => {
        actionCalled = true;
        return { dispatched: false };
      },
      resolveRecommendation: async () => {
        recommendationCalled = true;
      },
    },
  });
  const app = appWithSession("tenant-1", SESSION, deps);
  await app.request("/rec-1/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "recommendation", verdict: { kind: "APPROVE" } }),
  });
  assert.equal(recommendationCalled, true);
  assert.equal(actionCalled, false);
});

test("POST /:id/resolve returns 404 (not a 500) for an unknown or already-resolved item", async () => {
  const deps = fakeDeps({
    approvalQueue: {
      ...fakeDeps().approvalQueue,
      resolve: async () => {
        throw new UnknownActionError('No pending action "action-1" for tenant "tenant-1".');
      },
    },
  });
  const app = appWithSession("tenant-1", SESSION, deps);
  const res = await app.request("/action-1/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "action", verdict: { kind: "APPROVE" } }),
  });
  assert.equal(res.status, 404);
});

test("POST /:id/resolve surfaces UnknownRecommendationError as a 404 too", async () => {
  const deps = fakeDeps({
    approvalQueue: {
      ...fakeDeps().approvalQueue,
      resolveRecommendation: async () => {
        throw new UnknownRecommendationError('No pending recommendation "rec-1" for tenant "tenant-1".');
      },
    },
  });
  const app = appWithSession("tenant-1", SESSION, deps);
  const res = await app.request("/rec-1/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "recommendation", verdict: { kind: "APPROVE" } }),
  });
  assert.equal(res.status, 404);
});

test("POST /autonomy/:taskType/accept calls approvalQueue.acceptOffer, scoped to the real tenant", async () => {
  let called: [string, string] | undefined;
  const deps = fakeDeps({ approvalQueue: { acceptOffer: async (tenantId, taskType) => { called = [tenantId, taskType]; } } });
  const app = appWithSession("tenant-1", SESSION, deps);
  const res = await app.request("/autonomy/agent-1/accept", { method: "POST" });
  assert.equal(res.status, 200);
  assert.deepEqual(called, ["tenant-1", "agent-1"]);
});

test("POST /autonomy/:taskType/accept returns 404 when there's no pending offer", async () => {
  const deps = fakeDeps({
    approvalQueue: {
      acceptOffer: async () => {
        throw new Error('No pending autonomy offer for tenant "tenant-1", task type "agent-1".');
      },
    },
  });
  const app = appWithSession("tenant-1", SESSION, deps);
  const res = await app.request("/autonomy/agent-1/accept", { method: "POST" });
  assert.equal(res.status, 404);
});
