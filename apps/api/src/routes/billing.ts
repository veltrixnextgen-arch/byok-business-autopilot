import { zValidator } from "@hono/zod-validator";
import type { TenantTier } from "@byok/jobs";
import { Hono } from "hono";
import { z } from "zod";
import type { StripeClient } from "../billing/stripeClient.js";
import { StripeEventMissingTenantIdError, StripeSignatureError } from "../billing/stripeClient.js";
import type { AppEnv } from "../context.js";

const checkoutSchema = z.object({
  tier: z.enum(["solo", "company", "scale"]),
  period: z.enum(["monthly", "annual"]),
});

export interface BillingCheckoutRouteDeps {
  stripe: Pick<StripeClient, "createCheckoutSession">;
  webOrigin: string;
}

/**
 * Issue #18/ADR-045. Tenant-scoped, authenticated — the ONLY way a real
 * subscription starts. `POST /me/tier`'s old free mutation is gone (see
 * that file's own comment); this is what actually charges someone
 * before a tier ever changes. Returns a redirect URL, doesn't redirect
 * itself — apps/web sends the browser to Stripe's own hosted Checkout,
 * this route never touches card data (PCI scope stays entirely on
 * Stripe's side, by construction, not by care taken here).
 *
 * `deps` is `null` whenever no live Stripe account is configured yet
 * (no `STRIPE_SECRET_KEY`/price ids — see server.ts) — deliberately a
 * runtime null-check, not a route mounted/unmounted conditionally:
 * Hono's method-chaining type inference (index.ts's own comment on
 * `AppType`) needs the route chain to stay static regardless of config,
 * so "not configured" has to be a response this route returns, not an
 * absent route.
 */
export function billingCheckoutRoute(deps: BillingCheckoutRouteDeps | null) {
  return new Hono<AppEnv>().post("/checkout", zValidator("json", checkoutSchema), async (c) => {
    if (!deps) {
      return c.json({ error: "Billing isn't set up yet." }, 503);
    }

    const tenantId = c.get("tenantId");
    const session = c.get("session");
    const { tier, period } = c.req.valid("json");

    const { url } = await deps.stripe.createCheckoutSession({
      tenantId,
      tier,
      period,
      customerEmail: session.user.email,
      successUrl: `${deps.webOrigin}/settings?billing=success`,
      cancelUrl: `${deps.webOrigin}/settings?billing=canceled`,
    });

    return c.json({ url });
  });
}

export interface BillingWebhookRouteDeps {
  stripe: Pick<StripeClient, "constructWebhookEvent">;
  applyTierChange: (tenantId: string, tier: TenantTier) => Promise<unknown>;
  setTenantStripeIds: (tenantId: string, ids: { stripeCustomerId: string | null; stripeSubscriptionId: string | null }) => Promise<void>;
}

/**
 * No session, no tenantMiddleware — Stripe authenticates itself via the
 * signature header (verified inside stripe.constructWebhookEvent against
 * the real webhook secret), not a user session. Reads the RAW body via
 * `c.req.text()` before anything else touches it: Stripe's signature is
 * computed over the exact bytes it sent, and any JSON
 * parse-then-restringify would produce a byte-different payload the
 * signature would no longer match — this route deliberately never calls
 * `c.req.json()`.
 *
 * `tenants.tier` reverts to 'solo' (the column's own default, migration
 * 0010) on cancellation — directionally correct (losing a paid
 * subscription drops back to the baseline tier), but this does NOT mean
 * 'solo' itself is free: nothing in this codebase enforces the
 * per-tier company/agent/history/team-member limits pricingConstants.ts
 * advertises (confirmed nowhere in code — cadence floor is the only
 * tier-driven enforcement that exists). That's a real, separate,
 * pre-existing gap this route does not create and does not close — see
 * ADR-045's own closing note.
 */
export function billingWebhookRoute(deps: BillingWebhookRouteDeps | null) {
  return new Hono<AppEnv>().post("/webhook", async (c) => {
    if (!deps) {
      return c.json({ error: "Billing isn't set up yet." }, 503);
    }

    const signature = c.req.header("stripe-signature");
    if (!signature) {
      return c.json({ error: "Missing stripe-signature header." }, 400);
    }

    const rawBody = await c.req.text();
    let outcome;
    try {
      outcome = deps.stripe.constructWebhookEvent(rawBody, signature);
    } catch (err) {
      if (err instanceof StripeSignatureError) {
        return c.json({ error: "Invalid signature." }, 400);
      }
      if (err instanceof StripeEventMissingTenantIdError) {
        // A real bug (checkout session creation should always set this),
        // but not the caller's fault — 500, not 400, and Stripe will
        // retry, which is the right behavior while this gets fixed.
        throw err;
      }
      throw err;
    }

    switch (outcome.kind) {
      case "subscription-active":
        await deps.setTenantStripeIds(outcome.tenantId, {
          stripeCustomerId: outcome.stripeCustomerId,
          stripeSubscriptionId: outcome.stripeSubscriptionId,
        });
        await deps.applyTierChange(outcome.tenantId, outcome.tier);
        break;
      case "subscription-canceled":
        await deps.setTenantStripeIds(outcome.tenantId, { stripeCustomerId: outcome.stripeCustomerId, stripeSubscriptionId: null });
        await deps.applyTierChange(outcome.tenantId, "solo");
        break;
      case "ignored":
        break;
    }

    return c.json({ received: true });
  });
}
