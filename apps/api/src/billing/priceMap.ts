import type { TenantTier } from "@byok/jobs";

export type BillingPeriod = "monthly" | "annual";

/**
 * Real Stripe Price ids for each (tier, period) pair — six total,
 * matching pricingConstants.ts's three tiers × two periods (ADR-044's
 * prices, ADR-045's billing wiring). These don't exist anywhere in code:
 * a Stripe account has to actually create the six Products/Prices first
 * (dashboard, or `stripe prices create`), then their real ids are set
 * here via env vars. There is no safe default or placeholder — an unset
 * price id must fail loudly at boot (see createStripePriceMapFromEnv),
 * not silently charge the wrong amount or fall back to a guess.
 */
export type StripePriceMap = Record<TenantTier, Record<BillingPeriod, string>>;

const ENV_VAR_BY_TIER_PERIOD: Record<TenantTier, Record<BillingPeriod, string>> = {
  solo: { monthly: "STRIPE_PRICE_SOLO_MONTHLY", annual: "STRIPE_PRICE_SOLO_ANNUAL" },
  company: { monthly: "STRIPE_PRICE_COMPANY_MONTHLY", annual: "STRIPE_PRICE_COMPANY_ANNUAL" },
  scale: { monthly: "STRIPE_PRICE_SCALE_MONTHLY", annual: "STRIPE_PRICE_SCALE_ANNUAL" },
};

export class MissingStripePriceIdError extends Error {}

export function createStripePriceMapFromEnv(env: Record<string, string | undefined>): StripePriceMap {
  const map = {} as StripePriceMap;
  for (const tier of Object.keys(ENV_VAR_BY_TIER_PERIOD) as TenantTier[]) {
    map[tier] = {} as Record<BillingPeriod, string>;
    for (const period of ["monthly", "annual"] as const) {
      const envVar = ENV_VAR_BY_TIER_PERIOD[tier][period];
      const value = env[envVar];
      if (!value) {
        throw new MissingStripePriceIdError(
          `${envVar} is not set. Create the real Stripe Price for ${tier}/${period} (ADR-044's prices) and set its id here — refusing to boot with billing half-configured.`,
        );
      }
      map[tier][period] = value;
    }
  }
  return map;
}

/** Reverse lookup — a Stripe subscription event carries a Price id, not
 *  our tier/period; this is how the webhook (routes/billing.ts) turns
 *  "this subscription's price is price_xyz" back into a real TenantTier
 *  to persist. Throws rather than guessing on an unrecognized price id
 *  (e.g. a Price deleted/recreated in Stripe without updating the six
 *  env vars above) — silently mapping to the wrong tier would mean
 *  charging one amount and granting a different tier's entitlements. */
export function tierForPriceId(priceMap: StripePriceMap, priceId: string): TenantTier {
  for (const tier of Object.keys(priceMap) as TenantTier[]) {
    for (const period of ["monthly", "annual"] as const) {
      if (priceMap[tier][period] === priceId) return tier;
    }
  }
  throw new Error(`Stripe price id "${priceId}" doesn't match any configured tier/period — check the six STRIPE_PRICE_* env vars.`);
}
