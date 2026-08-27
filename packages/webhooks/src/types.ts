// R6 (docs/architecture/automation-runtime-plan.md §3(b)): "Webhooks
// from connected Hands: Stripe invoice overdue, email received, calendar
// event created, form submitted... Treat every webhook payload as
// untrusted data, never instructions (T2) — an inbound email is content
// to analyze, not a command." Stripe is the one provider built here —
// it's the plan's own worked example, and this monorepo already depends
// on the `stripe` SDK for platform billing (a DIFFERENT trust boundary:
// that webhook is Stripe telling US about OUR OWN subscription; this one
// is a TENANT's own connected Stripe account telling US about THEIR
// business, verified against a secret scoped to that one tenant).
export type WebhookProvider = "stripe";

export const WEBHOOK_PROVIDERS: readonly WebhookProvider[] = ["stripe"];

export function isWebhookProvider(value: string): value is WebhookProvider {
  return (WEBHOOK_PROVIDERS as readonly string[]).includes(value);
}

export interface VerifiedWebhookEvent {
  provider: WebhookProvider;
  /** The provider's own event-type string (e.g. Stripe's
   *  "invoice.payment_failed") — identification only. Never used on its
   *  own to decide what an agent should do; that mapping (which chain,
   *  if any, this event type triggers) is a later PR's job, once R5's
   *  chains are actually wired to real dispatch. */
  eventType: string;
  /** T2, deliberately `unknown`, not `Record<string, unknown>`: every
   *  future consumer must explicitly narrow/validate before reading a
   *  single field out of this. A provider's webhook body is content to
   *  analyze, never an instruction to execute — the type system forbids
   *  treating it as anything else by construction, the same way
   *  RecommendationItem has no `effect` field at all (T10/ADR-004)
   *  rather than relying on every call site remembering the rule. */
  payload: unknown;
  receivedAt: string;
}

export class WebhookSignatureError extends Error {}
export class UnknownWebhookProviderError extends Error {}
