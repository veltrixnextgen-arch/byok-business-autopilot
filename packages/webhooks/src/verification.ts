import Stripe from "stripe";
import { UnknownWebhookProviderError, WebhookSignatureError, type VerifiedWebhookEvent, type WebhookProvider } from "./types.js";

/**
 * Provider-dispatched, timing-safe signature verification — the ONLY
 * path a raw webhook body may become a `VerifiedWebhookEvent`. Throws
 * WebhookSignatureError on anything wrong (missing header, bad
 * signature, expired timestamp) rather than returning a boolean —
 * matching StripeClient.constructWebhookEvent's own "throw, don't
 * silently degrade to unverified" discipline (apps/api/src/billing/
 * stripeClient.ts), the exact same reasoning R6's own build-order entry
 * names it for: "highest value, highest security surface."
 */
export function verifyWebhookSignature(
  provider: WebhookProvider,
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): VerifiedWebhookEvent {
  if (!signatureHeader) {
    throw new WebhookSignatureError(`Missing signature header for a "${provider}" webhook.`);
  }
  switch (provider) {
    case "stripe":
      return verifyStripeSignature(rawBody, signatureHeader, secret);
    default: {
      const exhaustive: never = provider;
      throw new UnknownWebhookProviderError(`No signature verification implemented for provider "${String(exhaustive)}".`);
    }
  }
}

/**
 * Reuses Stripe's own SDK for the actual verification (timing-safe
 * HMAC-SHA256 comparison plus a timestamp-tolerance replay check) rather
 * than hand-rolling HMAC — the same reason apps/api's own platform-
 * billing webhook does (routes/billing.ts / stripeClient.ts): this is
 * security-critical code with an official, already-audited
 * implementation already a dependency of this monorepo.
 *
 * The `Stripe` client instance here is constructed with a placeholder
 * key, deliberately — `webhooks.constructEvent` is pure, local signature
 * verification against the caller-supplied `secret`; it makes no network
 * call and never touches the client's own API key. Using a real key here
 * would be actively wrong: this secret belongs to ONE TENANT's own
 * connected Stripe account, verified per-request against THAT tenant's
 * stored secret (a durable, per-tenant WebhookEndpointSecretStore — a
 * later PR), never our platform's own STRIPE_SECRET_KEY.
 */
function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string): VerifiedWebhookEvent {
  const client = new Stripe("sk_not_used_for_signature_verification");
  let event: Stripe.Event;
  try {
    event = client.webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch (err) {
    throw new WebhookSignatureError(err instanceof Error ? err.message : "Invalid Stripe webhook signature.");
  }
  return { provider: "stripe", eventType: event.type, payload: event.data.object, receivedAt: new Date().toISOString() };
}
