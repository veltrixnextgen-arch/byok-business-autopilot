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

test("200s with the correct token and lists every registered job scheduler across all tenants", async () => {
  const app = internalSchedulerDebugRoute(fakeDeps());
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });

  assert.equal(res.status, 200);
  const body = (await res.json()) as { count: number; schedulers: unknown[] };
  assert.equal(body.count, 2);
  assert.deepEqual(body.schedulers, [
    { id: "tenant-a:agent-1:task-1", every: 900000 },
    { id: "tenant-b:agent-2:task-2", pattern: "0 9 * * *" },
  ]);
});

test("200s with an empty list when nothing is registered anywhere", async () => {
  const app = internalSchedulerDebugRoute(fakeDeps({ queue: { async getJobSchedulers() { return []; } } }));
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });

  assert.equal(res.status, 200);
  const body = (await res.json()) as { count: number; schedulers: unknown[] };
  assert.equal(body.count, 0);
  assert.deepEqual(body.schedulers, []);
});
