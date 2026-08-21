import assert from "node:assert/strict";
import { test } from "node:test";
import { healthRoute } from "./health.js";

test("reports ok with 200, and both connections' real status, when Redis is healthy", async () => {
  const app = healthRoute({
    redis: { queue: { status: "ready", readyAtMs: 123 }, worker: { status: "ready", readyAtMs: 456 } },
    buildSha: "abc123",
  });
  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok", redis: { queue: "ready", worker: "ready" }, buildSha: "abc123" });
});

// ADR-029: this is the whole point of the field — deploy-staging.yml
// polls it and compares against the commit it just deployed, so a stale
// or never-updated build is detectable from outside the process.
test("reports the exact buildSha it was constructed with, unmodified", async () => {
  const app = healthRoute({
    redis: { queue: { status: "ready", readyAtMs: 123 }, worker: { status: "ready", readyAtMs: 456 } },
    buildSha: "unknown",
  });
  const res = await app.request("/");
  const body = (await res.json()) as { buildSha: string };
  assert.equal(body.buildSha, "unknown");
});

// The whole point: a broken Redis connection must be visible in the body,
// not silently reported as if nothing were wrong.
test("still returns HTTP 200 (Railway's own deploy verification gates on this) but the body shows redis status as 'error', not swallowed", async () => {
  const app = healthRoute({
    redis: {
      queue: { status: "error", error: "Redis connection did not become ready within 15000ms" },
      worker: { status: "ready", readyAtMs: 789 },
    },
    buildSha: "abc123",
  });
  const res = await app.request("/");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { status: "ok", redis: { queue: "error", worker: "ready" }, buildSha: "abc123" });
  // The detailed error message is deliberately NOT exposed on this public,
  // unauthenticated route -- it lives behind /internal/scheduler-debug's
  // token gate instead.
  assert.doesNotMatch(JSON.stringify(body), /did not become ready/);
});

test("reports 'initializing' during a normal cold start, still 200 -- not treated as a failure", async () => {
  const app = healthRoute({
    redis: { queue: { status: "initializing" }, worker: { status: "initializing" } },
    buildSha: "abc123",
  });
  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok", redis: { queue: "initializing", worker: "initializing" }, buildSha: "abc123" });
});
