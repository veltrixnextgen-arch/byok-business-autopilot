export type BillingPeriod = "monthly" | "quarterly" | "yearly";

/**
 * Real Stripe Price ids, one per billing period — three total (ADR-057
 * collapsed Solo/Company/Scale into a single plan, so this is no longer
 * a (tier, period) map). These don't exist anywhere in code: a Stripe
 * account has to actually create the three Prices first (dashboard, or
 * `stripe prices create`), then their real ids are set here via env
 * vars. There is no safe default or placeholder — an unset price id must
 * fail loudly at boot (see createStripePriceMapFromEnv), not silently
 * charge the wrong amount or fall back to a guess.
 */
export type StripePriceMap = Record<BillingPeriod, string>;

const ENV_VAR_BY_PERIOD: Record<BillingPeriod, string> = {
  monthly: "STRIPE_PRICE_MONTHLY",
  quarterly: "STRIPE_PRICE_QUARTERLY",
  yearly: "STRIPE_PRICE_YEARLY",
};

export class MissingStripePriceIdError extends Error {}

export function createStripePriceMapFromEnv(env: Record<string, string | undefined>): StripePriceMap {
  const map = {} as StripePriceMap;
  for (const period of ["monthly", "quarterly", "yearly"] as const) {
    const envVar = ENV_VAR_BY_PERIOD[period];
    const value = env[envVar];
    if (!value) {
      throw new MissingStripePriceIdError(
        `${envVar} is not set. Create the real Stripe Price for ${period} (ADR-057's prices) and set its id here — refusing to boot with billing half-configured.`,
      );
    }
    map[period] = value;
  }
  return map;
}

export class UnknownStripePriceIdError extends Error {}

/** A Stripe subscription event carries a Price id — the webhook
 *  (routes/billing.ts) needs to confirm it's one of ours before trusting
 *  the event at all, rather than silently accepting whatever Stripe
 *  sends (e.g. a Price deleted/recreated in Stripe without updating the
 *  three env vars above). One plan means there's no tier left to resolve
 *  from it — this only guards against an unrecognized price, it no
 *  longer returns anything. */
export function assertKnownPriceId(priceMap: StripePriceMap, priceId: string): void {
  const known = new Set(Object.values(priceMap));
  if (!known.has(priceId)) {
    throw new UnknownStripePriceIdError(`Stripe price id "${priceId}" doesn't match any configured period — check the three STRIPE_PRICE_* env vars.`);
  }
}
