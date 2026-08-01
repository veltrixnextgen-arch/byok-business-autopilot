import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { AppEnv } from "../context.js";
import { requireStepUp } from "./stepUp.js";

function appWithSessionStepUp(stepUp: { stepUpVerifiedAt?: number | null; stepUpMethod?: string | null }) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("session", { session: stepUp, user: {} } as never);
      await next();
    })
    .get("/protected", requireStepUp("key_ops"), (c) => c.json({ ok: true }));
}

test("403s when no step-up assertion is on the session", async () => {
  const res = await appWithSessionStepUp({}).request("/protected");
  assert.equal(res.status, 403);
});

test("403s when the step-up assertion is stale", async () => {
  const res = await appWithSessionStepUp({
    stepUpVerifiedAt: Date.now() - 10 * 60 * 1000,
    stepUpMethod: "totp",
  }).request("/protected");
  assert.equal(res.status, 403);
});

test("passes through with a fresh totp step-up", async () => {
  const res = await appWithSessionStepUp({
    stepUpVerifiedAt: Date.now(),
    stepUpMethod: "totp",
  }).request("/protected");
  assert.equal(res.status, 200);
});

test("a client cannot spoof step-up via a header — only the session record is consulted", async () => {
  const res = await appWithSessionStepUp({}).request("/protected", {
    headers: { "x-step-up-verified-at": new Date().toISOString(), "x-step-up-method": "totp" },
  });
  assert.equal(res.status, 403);
});
