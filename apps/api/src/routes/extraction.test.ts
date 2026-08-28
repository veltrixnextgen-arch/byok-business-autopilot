import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { AppEnv } from "../context.js";
import { extractionRoute, type ExtractionRouteDeps } from "./extraction.js";

function appWithUser(userId: string, deps: ExtractionRouteDeps) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("userId", userId);
      await next();
    })
    .route("/extraction", extractionRoute(deps));
}

function fakeDeps(overrides: Partial<ExtractionRouteDeps> = {}): ExtractionRouteDeps {
  return {
    costGate: { evaluateAndReserve: () => ({ verdict: { kind: "SKIP", reason: "unused in this test", model: "x" } }) } as never,
    apiKey: "test-key",
    batchStore: {
      start: async () => {
        throw new Error("unused in this test");
      },
      complete: async () => {},
      fail: async () => {},
      latestForUser: async () => null,
    } as never,
    taskDeltaStore: {
      recordMany: async () => {},
    } as never,
    websiteSummary: {
      costGate: { evaluateAndReserve: () => ({ verdict: { kind: "SKIP", reason: "unused in this test", model: "x" } }) } as never,
      apiKey: "test-key",
      fetchText: async () => {
        throw new Error("unused in this test");
      },
    },
    ...overrides,
  };
}

const BASE_TASK = {
  id: "t-1",
  text: "existing task",
  agentType: "x",
  agentLabel: "X",
  teamHint: "ops",
  frequency: "weekly",
  stakes: "low",
  tier: "T1",
  autonomy: "locked",
  handsTool: null,
  origin: "template",
  cadence: null,
  batchable: false,
  triggerType: "cadence",
} as const;

test("/questions returns a growing question list as a template narrows, with zero UI-side logic", async () => {
  const app = appWithUser("user-1", fakeDeps());

  const res = await app.request("/extraction/questions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea: "I want to run a community makerspace with equipment rentals" }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as { questions: unknown[]; templateHint: string | null };
  assert.equal(body.templateHint, "physical-space");
  // 5 spine + this template's 2 branch questions + 2 context = 9.
  assert.equal(body.questions.length, 9);
});

test("/questions falls back to spine-only questions when nothing points at a template yet", async () => {
  const app = appWithUser("user-1", fakeDeps());

  const res = await app.request("/extraction/questions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea: "something" }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as { questions: unknown[]; templateHint: string | null };
  assert.equal(body.templateHint, null);
  // 5 spine + 0 branch + 2 context = 7.
  assert.equal(body.questions.length, 7);
});

test("/batches/latest reads through to the batch store for the session's userId", async () => {
  let seenUserId: string | undefined;
  const app = appWithUser("user-42", fakeDeps({
    batchStore: {
      start: async () => {
        throw new Error("unused");
      },
      complete: async () => {},
      fail: async () => {},
      latestForUser: async (userId: string) => {
        seenUserId = userId;
        return null;
      },
    } as never,
  }));

  const res = await app.request("/extraction/batches/latest");

  assert.equal(res.status, 200);
  assert.equal(seenUserId, "user-42");
  assert.deepEqual(await res.json(), { batch: null });
});

test("/batches/:id/reassemble records template-learning deltas for the task-list edit", async () => {
  const recorded: Array<{ userId: string; batchId: string; templateId: string; deltas: unknown[]; source: string }> = [];
  const orgChart = {
    meta: {
      idea: "test idea",
      generatedAt: new Date().toISOString(),
      templateSelection: {
        primary: "service",
        blendedWith: null,
        scores: { ecommerce: 0, service: 5, saas: 0, content: 0, local: 0, "physical-space": 0, "food-hospitality": 0 },
        tie: false,
        confidence: "high",
      },
      calls: [],
      costUsd: 0.03,
    },
    teams: [],
    agents: [],
    tasks: [BASE_TASK],
    customization: { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] },
    onboardingBatch: null,
  };
  const app = appWithUser(
    "user-1",
    fakeDeps({
      batchStore: {
        get: async () => ({ id: "batch-1", userId: "user-1", tenantId: null, idea: "test idea", status: "completed", orgChart, costUsd: 0.03, error: null, createdAt: "", updatedAt: "" }),
        updateOrgChart: async () => {},
      } as never,
      taskDeltaStore: {
        recordMany: async (userId: string, batchId: string, templateId: string, deltas: readonly unknown[], source: string) => {
          recorded.push({ userId, batchId, templateId, deltas: [...deltas], source });
        },
      } as never,
    }),
  );

  const newTask = { ...BASE_TASK, id: "t-2", text: "new task" };
  const res = await app.request("/extraction/batches/batch-1/reassemble", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tasks: [newTask] }),
  });

  assert.equal(res.status, 200);
  assert.equal(recorded.length, 1);
  const [rec] = recorded;
  assert.equal(rec.userId, "user-1");
  assert.equal(rec.batchId, "batch-1");
  assert.equal(rec.templateId, "service");
  assert.equal(rec.source, "reassemble");
  // t-1 removed, t-2 added.
  assert.equal(rec.deltas.length, 2);
});

test("/website-summary 400s on a malformed URL, before ever reaching runWebsiteSummary", async () => {
  const app = appWithUser("user-1", fakeDeps());

  const res = await app.request("/extraction/website-summary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "not a url" }),
  });

  assert.equal(res.status, 400);
});

test("/website-summary returns the real runWebsiteSummary result under { result }", async () => {
  const app = appWithUser(
    "user-1",
    fakeDeps({
      websiteSummary: {
        costGate: {
          evaluateAndReserve: () => ({
            verdict: { kind: "PROCEED", model: "claude-haiku-4-5-20251001" },
            reservation: { id: "r-1", roleId: "onboarding", taskType: "website-summary", amountUsd: 0.01, createdAt: "", status: "reserved" },
          }),
          settle: async () => {},
          release: async () => {},
        } as never,
        apiKey: "test-key",
        fetchText: async () => ({ text: "Acme sells handmade candles online, worldwide, direct to consumers.".repeat(3), finalUrl: "https://acme.example/" }),
        summarize: async () => ({ sufficientContent: true, summary: "Acme sells handmade candles.", costUsd: 0.003 }),
      },
    }),
  );

  const res = await app.request("/extraction/website-summary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://acme.example/" }),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { result: { status: "completed", summary: "Acme sells handmade candles." } });
});
