import assert from "node:assert/strict";
import { test } from "node:test";
import { internalMetricsRoute, type InternalMetricsDeps } from "./internalMetrics.js";

function fakePool(users: { id: string; email: string; created_at: string }[]) {
  return {
    async connect() {
      return {
        async query() {
          return { rows: users };
        },
        release() {},
      };
    },
  };
}

function fakeDeps(overrides: Partial<InternalMetricsDeps> = {}): InternalMetricsDeps {
  return {
    pool: fakePool([{ id: "user-1", email: "tester@example.com", created_at: "2026-08-04T00:00:00.000Z" }]) as never,
    metricsStore: {
      allFunnelEvents: async () => [
        { userId: "user-1", screen: "signup", at: "2026-08-04T00:00:00.000Z" },
        { userId: "user-1", screen: "interview", at: "2026-08-04T00:01:00.000Z" },
        { userId: "user-1", screen: "tasks", at: "2026-08-04T00:02:00.000Z" },
        { userId: "user-1", screen: "org_chart", at: "2026-08-04T00:03:00.000Z" },
      ],
      allFeedback: async () => [{ userId: "user-1", taughtSomething: true, freeText: "yes!", at: "2026-08-04T00:03:30.000Z" }],
    },
    batchStore: {
      allLatestBatchSummaries: async () => [
        { userId: "user-1", status: "completed" as const, costUsd: 0.041, createdAt: "2026-08-04T00:00:30.000Z" },
      ],
    },
    token: "correct-token",
    ...overrides,
  };
}

test("401s with no token, body is a plain error with no signup data", async () => {
  const app = internalMetricsRoute(fakeDeps());
  const res = await app.request("/");
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.deepEqual(body, { error: "Unauthorized" });
  const raw = JSON.stringify(body);
  assert.doesNotMatch(raw, /tester@example\.com/);
  assert.doesNotMatch(raw, /user-1/);
});

test("401s with the wrong token, body is a plain error with no signup data", async () => {
  const app = internalMetricsRoute(fakeDeps());
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "wrong" } });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.deepEqual(body, { error: "Unauthorized" });
  const raw = JSON.stringify(body);
  assert.doesNotMatch(raw, /tester@example\.com/);
  assert.doesNotMatch(raw, /user-1/);
});

// Belt-and-suspenders on the route itself: the auth check must run before
// any query, not just before the response is composed — otherwise a fixed
// error body could still mask a query that already ran and could throw or
// leak via timing/logs. Fails deps.pool.connect() outright so any code
// path that reaches the DB before the token check would blow up instead
// of quietly succeeding.
test("rejects unauthorized requests before ever touching the database", async () => {
  const deps = fakeDeps({
    pool: {
      async connect() {
        throw new Error("must not be called before the token check");
      },
    } as never,
  });
  const app = internalMetricsRoute(deps);
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "wrong" } });
  assert.equal(res.status, 401);
});

test("200s with the correct token and renders per-signup completion, drop-off, cost, time-to-org-chart, and feedback", async () => {
  const app = internalMetricsRoute(fakeDeps());
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });

  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /tester@example\.com/);
  assert.match(html, /org_chart/); // reached every screen, so the drop-off column shows the last one
  assert.match(html, /\$0\.0410/); // cost, formatted to 4 decimal places
  assert.match(html, /180s/); // signup at :00, org_chart at :03 -> 180 seconds
  assert.match(html, /Yes: yes!/); // feedback answer + free text
});

// Same reasoning as tenantContext.test.ts's release(err) coverage (PR
// #131): a connection that errors mid-query may be broken, not just the
// query -- releasing it "clean" would hand a broken connection to
// whichever unrelated request does the next pool.connect().
test("releases the client WITH the original error when the query fails, so pg.Pool discards it", async () => {
  const boom = new Error("connection reset mid-query");
  let releasedWith: unknown;
  const deps = fakeDeps({
    pool: {
      async connect() {
        return {
          async query() {
            throw boom;
          },
          release(err?: unknown) {
            releasedWith = err;
          },
        };
      },
    } as never,
  });

  const app = internalMetricsRoute(deps);
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });

  assert.equal(res.status, 500);
  assert.equal(releasedWith, boom);
});

test("a user with no events at all shows idea_input as the drop-off point, not a crash", async () => {
  const app = internalMetricsRoute(
    fakeDeps({
      metricsStore: {
        allFunnelEvents: async () => [],
        allFeedback: async () => [],
      },
      batchStore: { allLatestBatchSummaries: async () => [] },
    }),
  );
  const res = await app.request("/", { headers: { "x-internal-metrics-token": "correct-token" } });

  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /idea_input/);
});
