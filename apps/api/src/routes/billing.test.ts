import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { AppEnv, AppSession } from "../context.js";
import { StripeEventMissingTenantIdError, StripeSignatureError, type BillingWebhookOutcome } from "../billing/stripeClient.js";
import { billingCheckoutRoute, billingWebhookRoute, type BillingCheckoutRouteDeps, type BillingWebhookRouteDeps } from "./billing.js";

function checkoutAppWithSession(tenantId: string, session: AppSession, deps: BillingCheckoutRouteDeps | null) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", billingCheckoutRoute(deps));
}

const SESSION = { user: { id: "user-1", email: "founder@example.com" }, session: {} } as never;

test("POST /checkout 503s cleanly when billing isn't configured, instead of the route not existing", async () => {
  const app = checkoutAppWithSession("tenant-1", SESSION, null);
  const res = await app.request("/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ period: "monthly" }),
  });
  assert.equal(res.status, 503);
});

test("POST /checkout 400s on a period outside the real enum, before ever calling Stripe", async () => {
  const app = checkoutAppWithSession("tenant-1", SESSION, {
    stripe: {
      createCheckoutSession: async () => {
        throw new Error("must not be called");
      },
    },
    webOrigin: "https://app.example.com",
  });
  const res = await app.request("/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ period: "annual" }),
  });
  assert.equal(res.status, 400);
});

test("POST /checkout passes the tenant's real id/period/email through and returns Stripe's own redirect url", async () => {
  let seenParams: unknown;
  const app = checkoutAppWithSession("tenant-1", SESSION, {
    stripe: {
      createCheckoutSession: async (params) => {
        seenParams = params;
        return { url: "https://checkout.stripe.com/session-abc" };
      },
    },
    webOrigin: "https://app.example.com",
  });
  const res = await app.request("/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ period: "yearly" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: "https://checkout.stripe.com/session-abc" });
  assert.deepEqual(seenParams, {
    tenantId: "tenant-1",
    period: "yearly",
    customerEmail: "founder@example.com",
    successUrl: "https://app.example.com/settings?billing=success",
    cancelUrl: "https://app.example.com/settings?billing=canceled",
  });
});

function webhookApp(deps: BillingWebhookRouteDeps | null) {
  return new Hono<AppEnv>().route("/", billingWebhookRoute(deps));
}

function fakeWebhookDeps(overrides: Partial<BillingWebhookRouteDeps> & { outcome?: BillingWebhookOutcome } = {}) {
  const applyTierChangeCalls: string[] = [];
  const setTenantStripeIdsCalls: [string, { stripeCustomerId: string | null; stripeSubscriptionId: string | null }][] = [];
  return {
    applyTierChangeCalls,
    setTenantStripeIdsCalls,
    deps: {
      stripe: {
        constructWebhookEvent: () => overrides.outcome ?? ({ kind: "ignored", type: "unhandled.event" } as BillingWebhookOutcome),
      },
      applyTierChange: async (tenantId: string) => {
        applyTierChangeCalls.push(tenantId);
      },
      setTenantStripeIds: async (tenantId: string, ids: { stripeCustomerId: string | null; stripeSubscriptionId: string | null }) => {
        setTenantStripeIdsCalls.push([tenantId, ids]);
      },
      ...overrides,
    } as BillingWebhookRouteDeps,
  };
}

test("POST /webhook 503s cleanly when billing isn't configured", async () => {
  const app = webhookApp(null);
  const res = await app.request("/webhook", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" });
  assert.equal(res.status, 503);
});

test("POST /webhook 400s when the stripe-signature header is missing entirely", async () => {
  const { deps } = fakeWebhookDeps();
  const app = webhookApp(deps);
  const res = await app.request("/webhook", { method: "POST", body: "{}" });
  assert.equal(res.status, 400);
});

test("POST /webhook 400s on a signature Stripe itself rejects, never processing the payload", async () => {
  const app = webhookApp({
    stripe: {
      constructWebhookEvent: () => {
        throw new StripeSignatureError("bad signature");
      },
    },
    applyTierChange: async () => {
      throw new Error("must not be called");
    },
    setTenantStripeIds: async () => {
      throw new Error("must not be called");
    },
  });
  const res = await app.request("/webhook", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" });
  assert.equal(res.status, 400);
});

test("POST /webhook re-throws (500s) when a subscription event has no tenantId in its metadata — a real bug, not a bad request", async () => {
  const app = webhookApp({
    stripe: {
      constructWebhookEvent: () => {
        throw new StripeEventMissingTenantIdError("no tenantId");
      },
    },
    applyTierChange: async () => {
      throw new Error("must not be called");
    },
    setTenantStripeIds: async () => {
      throw new Error("must not be called");
    },
  });
  const res = await app.request("/webhook", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" });
  assert.equal(res.status, 500);
});

test("POST /webhook on subscription-active persists the Stripe ids AND applies the tier change, in that order", async () => {
  const { deps, applyTierChangeCalls, setTenantStripeIdsCalls } = fakeWebhookDeps({
    outcome: { kind: "subscription-active", tenantId: "tenant-1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" },
  });
  const app = webhookApp(deps);
  const res = await app.request("/webhook", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" });
  assert.equal(res.status, 200);
  assert.deepEqual(setTenantStripeIdsCalls, [["tenant-1", { stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" }]]);
  assert.deepEqual(applyTierChangeCalls, ["tenant-1"]);
});

test("POST /webhook on subscription-canceled clears the subscription id and still applies the tier change", async () => {
  const { deps, applyTierChangeCalls, setTenantStripeIdsCalls } = fakeWebhookDeps({
    outcome: { kind: "subscription-canceled", tenantId: "tenant-1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" },
  });
  const app = webhookApp(deps);
  const res = await app.request("/webhook", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" });
  assert.equal(res.status, 200);
  assert.deepEqual(setTenantStripeIdsCalls, [["tenant-1", { stripeCustomerId: "cus_1", stripeSubscriptionId: null }]]);
  assert.deepEqual(applyTierChangeCalls, ["tenant-1"]);
});

test("POST /webhook on an ignored event type does nothing but still acknowledges Stripe with 200", async () => {
  const { deps, applyTierChangeCalls, setTenantStripeIdsCalls } = fakeWebhookDeps({ outcome: { kind: "ignored", type: "invoice.paid" } });
  const app = webhookApp(deps);
  const res = await app.request("/webhook", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true });
  assert.equal(applyTierChangeCalls.length, 0);
  assert.equal(setTenantStripeIdsCalls.length, 0);
});
