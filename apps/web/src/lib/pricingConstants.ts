// Single source of truth for tier pricing on the marketing /pricing page.
// Real prices unchanged since ADR-044 (docs/DECISIONS.md, 2026-08-26) —
// this pass re-differentiates WHAT the tiers gate, not the dollar
// amounts. Annual stays a flat 2 months free on every tier (10x the
// monthly rate — priceAnnualUsd already bakes that in; the effective
// monthly rate PricingPage shows for annual billing is derived as
// priceAnnualUsd / 12, not hand-typed, so it can never drift from the
// annual total actually charged.
//
// Differentiation is now on things that actually cost us or genuinely
// scale — never on agent count (agents cost nothing to run; the whole
// point of the org chart is showing everything the business needs) and
// never on AI provider count (BYOK means the user pays their own
// provider directly — gating that would undercut the "no markup"
// positioning). Cadence — how often a company's agents actually run —
// is the sharpest, most honest differentiator: it maps directly to real
// infrastructure cost via each tier's cadence floor
// (packages/jobs/src/cadenceFloors.ts: solo=daily, company=hourly,
// scale=15min), and "how often your company works" is immediately
// legible to a buyer in a way "20 agents vs. unlimited" never was.
export interface PricingTier {
  id: string;
  name: string;
  tagline: string;
  priceMonthlyUsd: number;
  priceAnnualUsd: number;
  /** Short cadence label for the lead badge (Company/Scale only —
   *  leadWithCadence gates whether PricingPage renders it as a
   *  standalone, emphasized badge above the stat line). Always also
   *  appears inline in `stats` so every tier's card reads the same way
   *  at a glance, badge or not. */
  cadenceLabel: string;
  leadWithCadence: boolean;
  /** Ordered, dot-joined stat line — company count, agents (always
   *  "Unlimited"), cadence, Hands connections, history, seats, support.
   *  Deliberately flat strings, not per-field typed columns: these
   *  differ enough in shape across tiers (e.g. "Up to 10 companies" vs
   *  "3 companies") that a shared field-label grid would need as much
   *  per-tier special-casing as just writing the line out. */
  stats: string[];
  /** "Everything" for Solo's full foundational list, "Adds" for
   *  Company/Scale's incremental-over-the-previous-tier list — matches
   *  how the actual product works (Company is Solo plus more, not a
   *  separate feature set) and reads honestly instead of re-listing
   *  every earlier tier's features again on every card. */
  featuresLabel: "Everything" | "Adds";
  features: string[];
  mostComplete?: boolean;
  ctaLabel: string;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: "solo",
    name: "Solo",
    tagline: "One idea, one company, real structure.",
    priceMonthlyUsd: 39,
    priceAnnualUsd: 390,
    cadenceLabel: "Daily",
    leadWithCadence: false,
    stats: [
      "1 company",
      "Unlimited agents",
      "Daily cadence",
      "3 Hands connections",
      "30-day history",
      "1 seat",
      "Email support",
    ],
    featuresLabel: "Everything",
    features: [
      "Guided business interview",
      "Task discovery",
      "Org structure",
      "Approval queue",
      "Spending walls",
      "BYOK — any provider",
      "Dashboard",
    ],
    ctaLabel: "Describe your idea",
  },
  {
    id: "company",
    name: "Company",
    tagline: "Run the whole operation with real controls.",
    priceMonthlyUsd: 89,
    priceAnnualUsd: 890,
    cadenceLabel: "Hourly",
    leadWithCadence: true,
    stats: [
      "3 companies",
      "Unlimited agents",
      "Hourly cadence",
      "Unlimited Hands",
      "12-month history",
      "5 seats",
      "Priority support",
    ],
    featuresLabel: "Adds",
    features: [
      "Earned autonomy",
      "Per-agent spending walls",
      "Agent activity log",
      "Daily & weekly digest",
      "Company Charter",
      "Custom approval rules",
    ],
    mostComplete: true,
    ctaLabel: "Describe your idea",
  },
  {
    id: "scale",
    name: "Scale",
    tagline: "Multiple companies, delegated oversight.",
    priceMonthlyUsd: 249,
    priceAnnualUsd: 2490,
    cadenceLabel: "Every 15 minutes",
    leadWithCadence: true,
    stats: [
      "Up to 10 companies",
      "Unlimited agents",
      "15-minute cadence",
      "Unlimited Hands",
      "Unlimited history",
      "Unlimited seats",
      "Priority support + onboarding",
    ],
    featuresLabel: "Adds",
    features: ["Team management & roles", "Delegated approvals", "Per-company cost export", "Audit export"],
    ctaLabel: "Talk to us",
  },
];

// TODO(product): no sales-assist flow exists yet for the Scale tier — its
// CTA routes into the same idea box as Solo/Company (the only real
// onboarding path in the app today) rather than a fabricated "contact us"
// channel. Revisit once a real sales/contact flow exists.
