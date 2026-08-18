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
      getBackend() {
        return { connection: { status: "ready", opts: { commandTimeout: 10000 } } };
      },
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

test("200s with the correct token and reports both getJobCounts and getJobSchedulers as independent, timed probes", async () => {
  const app = internalSchedulerDebugRoute(fakeDeps());
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    jobCounts: { ok: boolean; value?: unknown };
    schedulers: { ok: boolean; value?: unknown };
  };
  assert.equal(body.jobCounts.ok, true);
  assert.deepEqual(body.jobCounts.value, { waiting: 0, active: 0, completed: 3, failed: 0, delayed: 1 });
  assert.equal(body.schedulers.ok, true);
  assert.deepEqual(body.schedulers.value, [
    { id: "tenant-a:agent-1:task-1", every: 900000 },
    { id: "tenant-b:agent-2:task-2", pattern: "0 9 * * *" },
  ]);
});

// The whole reason this route exists: telling "getJobSchedulers itself
// hangs" apart from "the connection is fine, only Job Scheduler calls
// hang" -- a getJobSchedulers() that never resolves must not stop
// getJobCounts()'s real result from being reported.
test(
  "a hung getJobSchedulers() still lets getJobCounts's real result through, reported as its own timeout",
  { timeout: 15000 },
  async () => {
    const app = internalSchedulerDebugRoute(
      fakeDeps({
        queue: {
          getJobSchedulers: () => new Promise(() => {}), // never resolves
          async getJobCounts() {
            return { waiting: 0, active: 0, completed: 3, failed: 0, delayed: 1 };
          },
        },
      }),
    );
    const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      jobCounts: { ok: boolean; value?: unknown };
      schedulers: { ok: boolean; error?: string };
    };
    assert.equal(body.jobCounts.ok, true);
    assert.deepEqual(body.jobCounts.value, { waiting: 0, active: 0, completed: 3, failed: 0, delayed: 1 });
    assert.equal(body.schedulers.ok, false);
    assert.match(body.schedulers.error ?? "", /exceeded/);
  },
);

test(
  "surfaces the underlying RedisConnection's status synchronously, even independent of whether the probes below succeed",
  { timeout: 15000 },
  async () => {
    const app = internalSchedulerDebugRoute(
      fakeDeps({
        queue: {
          getBackend() {
            return { connection: { status: "initializing", opts: { commandTimeout: 10000 } } };
          },
          getJobSchedulers: () => new Promise(() => {}), // never resolves -- status must still be reported
        },
      }),
    );
    const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { connectionStatus: { status?: string } };
    assert.equal(body.connectionStatus.status, "initializing");
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
