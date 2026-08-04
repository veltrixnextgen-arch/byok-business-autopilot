import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { AppEnv } from "../context.js";
import { signupMetricsRoute } from "./signupMetrics.js";

function appWithUser(userId: string, store: Parameters<typeof signupMetricsRoute>[0]) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("userId", userId);
      await next();
    })
    .route("/metrics", signupMetricsRoute(store));
}

test("/funnel-event records against the session's userId, never a client-supplied one", async () => {
  let seen: { userId: string; screen: string } | undefined;
  const app = appWithUser("user-1", {
    recordFunnelEvent: async (userId, screen) => {
      seen = { userId, screen };
    },
    recordFeedback: async () => {
      throw new Error("unused in this test");
    },
  });

  const res = await app.request("/metrics/funnel-event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // A spoofed userId in the body must be ignored — only c.get("userId")
    // (set by userMiddleware from the verified session) is ever used.
    body: JSON.stringify({ screen: "interview", userId: "someone-else" }),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(seen, { userId: "user-1", screen: "interview" });
});

test("/funnel-event rejects an unknown screen name before ever calling the store", async () => {
  let called = false;
  const app = appWithUser("user-1", {
    recordFunnelEvent: async () => {
      called = true;
    },
    recordFeedback: async () => {
      throw new Error("unused in this test");
    },
  });

  const res = await app.request("/metrics/funnel-event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ screen: "not-a-real-screen" }),
  });

  assert.equal(res.status, 400);
  assert.equal(called, false);
});

test("/feedback records taughtSomething and an optional free-text answer against the session's userId", async () => {
  let seen: { userId: string; taughtSomething: boolean; freeText: string | null } | undefined;
  const app = appWithUser("user-7", {
    recordFunnelEvent: async () => {
      throw new Error("unused in this test");
    },
    recordFeedback: async (userId, taughtSomething, freeText) => {
      seen = { userId, taughtSomething, freeText };
    },
  });

  const res = await app.request("/metrics/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taughtSomething: true, freeText: "didn't expect a compliance agent" }),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(seen, { userId: "user-7", taughtSomething: true, freeText: "didn't expect a compliance agent" });
});

test("/feedback treats freeText as optional", async () => {
  let seen: { taughtSomething: boolean; freeText: string | null } | undefined;
  const app = appWithUser("user-7", {
    recordFunnelEvent: async () => {
      throw new Error("unused in this test");
    },
    recordFeedback: async (_userId, taughtSomething, freeText) => {
      seen = { taughtSomething, freeText };
    },
  });

  const res = await app.request("/metrics/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taughtSomething: false }),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(seen, { taughtSomething: false, freeText: null });
});
