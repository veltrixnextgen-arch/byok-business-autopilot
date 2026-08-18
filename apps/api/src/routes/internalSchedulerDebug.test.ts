import assert from "node:assert/strict";
import { test } from "node:test";
import { internalSchedulerDebugRoute, type InternalSchedulerDebugDeps } from "./internalSchedulerDebug.js";

function fakeDeps(overrides: Partial<InternalSchedulerDebugDeps> = {}): InternalSchedulerDebugDeps {
  return {
    queue: {
      async getJobSchedulers() {
        return [
          { id: "tenant-a:agent-1:task-1", every: 900000 },
          { id: "tenant-b:agent-2:task-2", pattern: "0 9 * * *" },
        ];
      },
      async getJobCounts() {
        return { waiting: 0, active: 0, completed: 3, failed: 0, delayed: 1 };
      },
    },
    connectionHealth: {
      queue: { status: "ready", readyAtMs: 1000 },
      worker: { status: "ready", readyAtMs: 1000 },
    },
    token: "correct-token",
    ...overrides,
  };
}

test("401s with no token, no scheduler data leaked", async () => {
  const app = internalSchedulerDebugRoute(fakeDeps());
  const res = await app.request("/");
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.deepEqual(body, { error: "Unauthorized" });
});

test("401s with the wrong token", async () => {
  const app = internalSchedulerDebugRoute(fakeDeps());
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "wrong" } });
  assert.equal(res.status, 401);
});

test("200s with the correct token and reports connectionHealth plus both getJobCounts and getJobSchedulers as independent, timed probes", async () => {
  const app = internalSchedulerDebugRoute(fakeDeps());
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    connectionHealth: { queue: { status: string }; worker: { status: string } };
    jobCounts: { ok: boolean; value?: unknown };
    schedulers: { ok: boolean; value?: unknown };
  };
  assert.equal(body.connectionHealth.queue.status, "ready");
  assert.equal(body.connectionHealth.worker.status, "ready");
  assert.equal(body.jobCounts.ok, true);
  assert.deepEqual(body.jobCounts.value, { waiting: 0, active: 0, completed: 3, failed: 0, delayed: 1 });
  assert.equal(body.schedulers.ok, true);
  assert.deepEqual(body.schedulers.value, [
    { id: "tenant-a:agent-1:task-1", every: 900000 },
    { id: "tenant-b:agent-2:task-2", pattern: "0 9 * * *" },
  ]);
});

// This is the exact real-world failure the route was extended for: the
// connection stuck forever at "initializing", which trackConnectionHealth
// eventually flips to "error" -- reported here even while both queue
// probes are still hanging.
test(
  "reports connectionHealth as 'error' even while both probes are still hanging",
  { timeout: 15000 },
  async () => {
    const app = internalSchedulerDebugRoute(
      fakeDeps({
        connectionHealth: {
          queue: { status: "error", error: "Redis connection did not become ready within 15000ms" },
          worker: { status: "error", error: "Redis connection did not become ready within 15000ms" },
        },
        queue: {
          getJobSchedulers: () => new Promise(() => {}),
          getJobCounts: () => new Promise(() => {}),
        },
      }),
    );
    const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      connectionHealth: { queue: { status: string; error?: string } };
      jobCounts: { ok: boolean };
      schedulers: { ok: boolean };
    };
    assert.equal(body.connectionHealth.queue.status, "error");
    assert.match(body.connectionHealth.queue.error ?? "", /did not become ready/);
    assert.equal(body.jobCounts.ok, false);
    assert.equal(body.schedulers.ok, false);
  },
);

test("reports an empty scheduler list distinctly from a timeout", async () => {
  const app = internalSchedulerDebugRoute(fakeDeps({ queue: { async getJobSchedulers() { return []; } } }));
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });

  assert.equal(res.status, 200);
  const body = (await res.json()) as { schedulers: { ok: boolean; value?: unknown } };
  assert.equal(body.schedulers.ok, true);
  assert.deepEqual(body.schedulers.value, []);
});
