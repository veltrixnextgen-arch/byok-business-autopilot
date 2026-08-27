import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp, type CreateAppOptions } from "./index.js";

// ADR-053 (same-origin proxy, issue #144): a structural regression guard
// for the /api wrapping itself — every existing route-level test file
// (health.test.ts, dashboard.test.ts, ...) mounts its route directly at
// its own path, bypassing createApp() entirely, so none of them would
// ever catch a wiring mistake in how createApp() composes the real tree.
// This test constructs the real app (heavily stubbed deps — nothing
// below actually gets called except healthRoute's) and proves three
// facts about the composed route tree directly, by HTTP status code:
// browser-facing routes only resolve under /api now, the OLD unprefixed
// path is gone, and /billing (Stripe's own webhook target) is
// deliberately untouched at its original top-level path.
function fakeOptions(): CreateAppOptions {
  return {
    pool: {} as never,
    auth: { handler: async () => new Response("auth", { status: 200 }) } as never,
    trustCore: {} as never,
    webOrigin: "http://localhost:3002",
    webOrigins: ["http://localhost:3002"],
    extraction: {} as never,
    metrics: {} as never,
    handsOAuth: {} as never,
    scheduler: {
      queue: {} as never,
      jobName: "test",
      health: { queue: { status: "ready" }, worker: { status: "ready" } } as never,
      notifications: {} as never,
    },
    digest: {} as never,
    billing: null,
    buildSha: "test-sha",
  };
}

test("browser-facing routes resolve under /api, not at their old unprefixed path", async () => {
  const app = createApp(fakeOptions());

  const prefixed = await app.request("/api/health");
  assert.equal(prefixed.status, 200);
  const body = (await prefixed.json()) as { status: string; buildSha: string };
  assert.equal(body.status, "ok");
  assert.equal(body.buildSha, "test-sha");

  const unprefixed = await app.request("/health");
  assert.equal(unprefixed.status, 404);
});

test("/billing (Stripe's own webhook target) stays reachable at its original top-level path, not under /api", async () => {
  const app = createApp(fakeOptions());

  // billing: null in fakeOptions() means billingWebhookRoute's own
  // handler returns 503 ("billing not configured") rather than 404 —
  // the distinction that matters here: the ROUTE exists at this path
  // (not "no such path"), which is exactly what proves it wasn't moved
  // under /api alongside the browser-facing routes. billingWebhookRoute
  // mounts its own handler at /webhook internally, so the real path is
  // /billing/webhook, not bare /billing.
  const res = await app.request("/billing/webhook", { method: "POST" });
  assert.notEqual(res.status, 404);

  const movedUnderApi = await app.request("/api/billing/webhook", { method: "POST" });
  assert.equal(movedUnderApi.status, 404);
});
