import Stripe from "stripe";
import type { BillingPeriod, StripePriceMap } from "./priceMap.js";
import { tierForPriceId } from "./priceMap.js";
import type { TenantTier } from "@byok/jobs";

export interface CreateCheckoutSessionParams {
  tenantId: string;
  tier: TenantTier;
  period: BillingPeriod;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Normalized webhook outcomes — routes/billing.ts's webhook handler only
 * ever sees these three shapes, never a raw Stripe.Event. Deliberately
 * reacts to the SUBSCRIPTION lifecycle (created/updated/deleted), not
 * `checkout.session.completed`: Stripe's own guidance for subscription
 * billing is that the subscription object, not the checkout session, is
 * authoritative for entitlements — a completed checkout always produces
 * a corresponding subscription.created event with the real price id
 * directly on it (`items.data[0].price.id`), which the session object
 * doesn't carry without a separate line-items expansion. tenantId comes
 * from `subscription.metadata.tenantId` — set via `subscription_data.
 * metadata` at checkout-session creation, which Stripe copies onto the
 * resulting Subscription, so every later event about that subscription
 * carries it too without a DB lookup by customer/subscription id.
 */
export type BillingWebhookOutcome =
  | { kind: "subscription-active"; tenantId: string; stripeCustomerId: string; stripeSubscriptionId: string; tier: TenantTier }
  | { kind: "subscription-canceled"; tenantId: string; stripeCustomerId: string; stripeSubscriptionId: string }
  | { kind: "ignored"; type: string };

export class StripeSignatureError extends Error {}
export class StripeEventMissingTenantIdError extends Error {}

export interface StripeClient {
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<{ url: string }>;
  /** Verifies the webhook signature and normalizes the event. Throws
   *  StripeSignatureError on a bad/missing signature — routes/billing.ts
   *  maps that to a 400, never processes an unverified payload. */
  constructWebhookEvent(rawBody: string, signature: string): BillingWebhookOutcome;
}

function tenantIdFromMetadata(metadata: Stripe.Metadata | null): string {
  const tenantId = metadata?.tenantId;
  if (!tenantId) {
    throw new StripeEventMissingTenantIdError(
      "Stripe subscription event has no metadata.tenantId — checkout session creation must set subscription_data.metadata.tenantId.",
    );
  }
  return tenantId;
}

export function createStripeClient(secretKey: string, webhookSecret: string, priceMap: StripePriceMap): StripeClient {
  const client = new Stripe(secretKey);

  return {
    async createCheckoutSession(params) {
      const session = await client.checkout.sessions.create({
        mode: "subscription",
        customer_email: params.customerEmail,
        line_items: [{ price: priceMap[params.tier][params.period], quantity: 1 }],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        // Set on BOTH: session.metadata for anyone inspecting the
        // Checkout Session itself, subscription_data.metadata so it
        // propagates onto the real Subscription object every later
        // webhook event carries.
        metadata: { tenantId: params.tenantId },
        subscription_data: { metadata: { tenantId: params.tenantId } },
      });
      if (!session.url) {
        throw new Error("Stripe created a Checkout Session with no url — cannot redirect the tenant to pay.");
      }
      return { url: session.url };
    },

    constructWebhookEvent(rawBody, signature) {
      let event: Stripe.Event;
      try {
        event = client.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (err) {
        throw new StripeSignatureError(err instanceof Error ? err.message : "Invalid Stripe webhook signature.");
      }

      if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
        const subscription = event.data.object as Stripe.Subscription;
        const priceId = subscription.items.data[0]?.price.id;
        if (!priceId) {
          throw new Error(`Subscription ${subscription.id} has no line items — cannot determine its tier.`);
        }
        return {
          kind: "subscription-active",
          tenantId: tenantIdFromMetadata(subscription.metadata),
          stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
          stripeSubscriptionId: subscription.id,
          tier: tierForPriceId(priceMap, priceId),
        };
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object as Stripe.Subscription;
        return {
          kind: "subscription-canceled",
          tenantId: tenantIdFromMetadata(subscription.metadata),
          stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
          stripeSubscriptionId: subscription.id,
        };
      }

      return { kind: "ignored", type: event.type };
    },
  };
}
