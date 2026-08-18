import assert from "node:assert/strict";
import { test } from "node:test";
import { healthRoute } from "./health.js";

test("reports ok with 200, and both connections' real status, when Redis is healthy", async () => {
  const app = healthRoute({
    redis: { queue: { status: "ready", readyAtMs: 123 }, worker: { status: "ready", readyAtMs: 456 } },
  });
  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok", redis: { queue: "ready", worker: "ready" } });
});

// The whole point: a broken Redis connection must be visible in the body,
// not silently reported as if nothing were wrong.
test("still returns HTTP 200 (Railway's own deploy verification gates on this) but the body shows redis status as 'error', not swallowed", async () => {
  const app = healthRoute({
    redis: {
      queue: { status: "error", error: "Redis connection did not become ready within 15000ms" },
      worker: { status: "ready", readyAtMs: 789 },
    },
  });
  const res = await app.request("/");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { status: "ok", redis: { queue: "error", worker: "ready" } });
  // The detailed error message is deliberately NOT exposed on this public,
  // unauthenticated route -- it lives behind /internal/scheduler-debug's
  // token gate instead.
  assert.doesNotMatch(JSON.stringify(body), /did not become ready/);
});

test("reports 'initializing' during a normal cold start, still 200 -- not treated as a failure", async () => {
  const app = healthRoute({
    redis: { queue: { status: "initializing" }, worker: { status: "initializing" } },
  });
  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok", redis: { queue: "initializing", worker: "initializing" } });
});
