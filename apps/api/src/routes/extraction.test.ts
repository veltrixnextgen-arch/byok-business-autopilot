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
    ledger: { append: () => {}, entriesFor: () => [], allEntries: () => [] },
    apiKey: "test-key",
    batchStore: {
      start: async () => {
        throw new Error("unused in this test");
      },
      complete: async () => {},
      fail: async () => {},
      latestForUser: async () => null,
    } as never,
    ...overrides,
  };
}

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
