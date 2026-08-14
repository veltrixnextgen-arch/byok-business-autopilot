import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { Charter, CompanyCharter, OrgChart } from "@byok/contracts";
import type { AppEnv, AppSession } from "../context.js";
import { charterRoute, type CharterRouteDeps } from "./charter.js";

function appWithSession(tenantId: string, session: AppSession, deps: CharterRouteDeps) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", charterRoute(deps));
}

const SESSION = { user: { id: "user-1", email: "founder@example.com" }, session: {} } as never;

const CHARTER_CONTENT: Charter = {
  sharpenedIdea: "A candle shop on Etsy.",
  mvpDefinition: "Sell handmade candles online.",
  roleMandates: [{ roleTitle: "CFO", mandate: "Keeps the books current.", tasks: ["Categorize expenses"] }],
  monthOneGoals: ["Ship the first ten orders"],
  budgetCeilingUsd: 50,
};

const CHART: OrgChart = {
  meta: { idea: "candle shop", generatedAt: "2026-01-01T00:00:00.000Z", templateSelection: undefined as never, calls: [], costUsd: 0 },
  teams: [
    { id: "founder", roleTitle: "Founder", isHuman: true, agentIds: ["ceo-1"] },
    { id: "cfo", roleTitle: "CFO", isHuman: false, agentIds: ["agent-1"] },
  ],
  agents: [
    { id: "ceo-1", name: "Jordan", title: "Chief of Staff", teamId: "founder" as never, taskIds: [], tier: "T3", brain: null, hands: [], autonomyDefault: "earnable", complianceLocked: false, requiresProfessionalVerification: false },
    { id: "agent-1", name: "Sam", title: "Expenses", teamId: "cfo" as never, taskIds: ["task-1"], tier: "T1", brain: null, hands: [], autonomyDefault: "earnable", complianceLocked: false, requiresProfessionalVerification: false },
  ],
  tasks: [
    { id: "task-1", text: "Categorize expenses", agentType: "expense-categorization", agentLabel: "Expenses", teamHint: "cfo" as never, frequency: "weekly", stakes: "low", tier: "T1", autonomy: "earnable", handsTool: null, origin: "template" },
  ],
  customization: { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] },
  onboardingBatch: { simulatedDay: [], charterDraft: CHARTER_CONTENT },
};

function makeDraft(overrides: Partial<CompanyCharter> = {}): CompanyCharter {
  return {
    id: "charter-1",
    tenantId: "tenant-1",
    version: 1,
    status: "draft",
    content: CHARTER_CONTENT,
    cascade: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    installedAt: null,
    ...overrides,
  };
}

test("GET returns the raw org-chart draft when no Charter record exists yet", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    charters: {
      getActive: async () => null,
      getLatestDraft: async () => null,
      createDraft: async () => {
        throw new Error("unused");
      },
      updateDraft: async () => {
        throw new Error("unused");
      },
      accept: async () => {
        throw new Error("unused");
      },
      get: async () => {
        throw new Error("unused");
      },
    },
    batchStore: { latestForTenant: async () => ({ orgChart: CHART }) as never },
  });

  const res = await app.request("/");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { active: null; draft: null; rawDraft: Charter };
  assert.equal(body.active, null);
  assert.equal(body.draft, null);
  assert.deepEqual(body.rawDraft, CHARTER_CONTENT);
});

test("GET returns the existing draft without touching rawDraft once one has been created", async () => {
  const draft = makeDraft();
  const app = appWithSession("tenant-1", SESSION, {
    charters: {
      getActive: async () => null,
      getLatestDraft: async () => draft,
      createDraft: async () => {
        throw new Error("unused");
      },
      updateDraft: async () => {
        throw new Error("unused");
      },
      accept: async () => {
        throw new Error("unused");
      },
      get: async () => {
        throw new Error("unused");
      },
    },
    batchStore: {
      latestForTenant: async () => {
        throw new Error("must not be called once a draft row exists");
      },
    },
  });

  const res = await app.request("/");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { draft: CompanyCharter };
  assert.equal(body.draft.id, "charter-1");
});

test("POST /draft is idempotent — a second call never creates a second draft", async () => {
  const draft = makeDraft();
  let createCalls = 0;
  const app = appWithSession("tenant-1", SESSION, {
    charters: {
      getActive: async () => null,
      getLatestDraft: async () => draft,
      createDraft: async () => {
        createCalls++;
        return draft;
      },
      updateDraft: async () => {
        throw new Error("unused");
      },
      accept: async () => {
        throw new Error("unused");
      },
      get: async () => {
        throw new Error("unused");
      },
    },
    batchStore: { latestForTenant: async () => ({ orgChart: CHART }) as never },
  });

  const res = await app.request("/draft", { method: "POST" });
  assert.equal(res.status, 200);
  assert.equal(createCalls, 0);
});

test("POST /draft seeds a reopened Charter from the active version's content, not the raw org-chart draft", async () => {
  const activeContent: Charter = { ...CHARTER_CONTENT, monthOneGoals: ["Edited goal"] };
  const active = makeDraft({ status: "active", content: activeContent });
  let seenContent: Charter | undefined;
  const app = appWithSession("tenant-1", SESSION, {
    charters: {
      getActive: async () => active,
      getLatestDraft: async () => null,
      createDraft: async (_tenantId, content) => {
        seenContent = content;
        return makeDraft({ content });
      },
      updateDraft: async () => {
        throw new Error("unused");
      },
      accept: async () => {
        throw new Error("unused");
      },
      get: async () => {
        throw new Error("unused");
      },
    },
    batchStore: {
      latestForTenant: async () => {
        throw new Error("must not read the raw org-chart draft when an active Charter already exists");
      },
    },
  });

  const res = await app.request("/draft", { method: "POST" });
  assert.equal(res.status, 200);
  assert.deepEqual(seenContent, activeContent);
});

test("POST /draft 404s cleanly when there's no org chart to draft a Charter from", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    charters: {
      getActive: async () => null,
      getLatestDraft: async () => null,
      createDraft: async () => {
        throw new Error("must not be called");
      },
      updateDraft: async () => {
        throw new Error("unused");
      },
      accept: async () => {
        throw new Error("unused");
      },
      get: async () => {
        throw new Error("unused");
      },
    },
    batchStore: { latestForTenant: async () => null },
  });

  const res = await app.request("/draft", { method: "POST" });
  assert.equal(res.status, 404);
});

test("PATCH /draft/:id 404s when the store reports no editable draft", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    charters: {
      getActive: async () => null,
      getLatestDraft: async () => null,
      createDraft: async () => {
        throw new Error("unused");
      },
      updateDraft: async () => null,
      accept: async () => {
        throw new Error("unused");
      },
      get: async () => {
        throw new Error("unused");
      },
    },
    batchStore: { latestForTenant: async () => null },
  });

  const res = await app.request("/draft/charter-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CHARTER_CONTENT),
  });
  assert.equal(res.status, 404);
});

test("POST /draft/:id/accept generates a cascade from the draft content + claimed org chart and installs it", async () => {
  const draft = makeDraft();
  let acceptArgs: [string, string, unknown] | undefined;
  const app = appWithSession("tenant-1", SESSION, {
    charters: {
      getActive: async () => null,
      getLatestDraft: async () => draft,
      createDraft: async () => {
        throw new Error("unused");
      },
      updateDraft: async () => {
        throw new Error("unused");
      },
      get: async () => draft,
      accept: async (tenantId, id, cascade) => {
        acceptArgs = [tenantId, id, cascade];
        return { ...draft, status: "active", cascade, installedAt: "2026-01-02T00:00:00.000Z" };
      },
    },
    batchStore: { latestForTenant: async () => ({ orgChart: CHART }) as never },
  });

  const res = await app.request("/draft/charter-1/accept", { method: "POST" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { charter: CompanyCharter };
  assert.equal(body.charter.status, "active");
  assert.ok(acceptArgs);
  assert.equal(acceptArgs?.[0], "tenant-1");
  assert.equal(acceptArgs?.[1], "charter-1");
  const cascade = acceptArgs?.[2] as { ceo: { text: string }; roleLeads: unknown[]; subAgents: unknown[] };
  assert.ok(cascade.ceo.text.includes("Jordan"));
  assert.equal(cascade.roleLeads.length, 1);
  assert.equal(cascade.subAgents.length, 1);
});

test("POST /draft/:id/accept 409s when no org chart has been claimed yet", async () => {
  const draft = makeDraft();
  const app = appWithSession("tenant-1", SESSION, {
    charters: {
      getActive: async () => null,
      getLatestDraft: async () => draft,
      createDraft: async () => {
        throw new Error("unused");
      },
      updateDraft: async () => {
        throw new Error("unused");
      },
      get: async () => draft,
      accept: async () => {
        throw new Error("must not be called");
      },
    },
    batchStore: { latestForTenant: async () => null },
  });

  const res = await app.request("/draft/charter-1/accept", { method: "POST" });
  assert.equal(res.status, 409);
});

test("POST /draft/:id/accept 404s when the id isn't an editable draft", async () => {
  const app = appWithSession("tenant-1", SESSION, {
    charters: {
      getActive: async () => null,
      getLatestDraft: async () => null,
      createDraft: async () => {
        throw new Error("unused");
      },
      updateDraft: async () => {
        throw new Error("unused");
      },
      get: async () => null,
      accept: async () => {
        throw new Error("must not be called");
      },
    },
    batchStore: { latestForTenant: async () => null },
  });

  const res = await app.request("/draft/nonexistent/accept", { method: "POST" });
  assert.equal(res.status, 404);
});
