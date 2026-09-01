// Single source of truth for the /pricing page. ADR-057 collapsed
// Solo/Company/Scale into one plan — everything the product does,
// included, at every billing period. Differentiation used to be on
// cadence (packages/jobs/src/cadenceFloors.ts); that's now a uniform
// COGS-control floor applied to every tenant regardless of billing
// period, not a pricing lever — see ADR-057 for the real numbers behind
// picking "daily" as that one floor.
export interface BillingPeriodOption {
  id: "monthly" | "quarterly" | "yearly";
  label: string;
  /** What Stripe actually charges for this period. */
  billedUsd: number;
  /** billedUsd / months-in-period — the big number PricingPage shows.
   *  Always derived, never hand-typed, so it can't drift from billedUsd. */
  effectiveMonthlyUsd: number;
  savePercent: number | null;
}

const MONTHLY_USD = 39.99;

export const BILLING_PERIODS: BillingPeriodOption[] = [
  { id: "monthly", label: "Monthly", billedUsd: MONTHLY_USD, effectiveMonthlyUsd: MONTHLY_USD, savePercent: null },
  { id: "quarterly", label: "Quarterly", billedUsd: 107.97, effectiveMonthlyUsd: 107.97 / 3, savePercent: 10 },
  { id: "yearly", label: "Yearly", billedUsd: 383.9, effectiveMonthlyUsd: 383.9 / 12, savePercent: 20 },
];

export const PLAN = {
  name: "Runwisely",
  tagline: "Everything the product does. One plan.",
  stats: ["1 company", "Unlimited agents", "Daily cadence", "Unlimited Hands connections", "Unlimited history", "Unlimited seats", "Priority support"],
  features: [
    "Guided business interview",
    "Task discovery",
    "Org structure",
    "Approval queue",
    "Spending walls",
    "BYOK — any provider",
    "Dashboard",
    "Earned autonomy",
    "Per-agent spending walls",
    "Agent activity log",
    "Daily & weekly digest",
    "Company Charter",
    "Custom approval rules",
  ],
  ctaLabel: "Describe your idea",
};
