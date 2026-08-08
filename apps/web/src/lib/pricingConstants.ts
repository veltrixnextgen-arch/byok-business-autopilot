// Single source of truth for tier pricing on the marketing /pricing page.
// No monthly price has been set by product yet — the reference itself
// ships with "—/month" placeholders and an on-page "Pricing not finalised"
// disclaimer (captured live 2026-08-08), so `priceLabel: "—"` here matches
// that, not a guess of our own. Whoever sets real prices only has to edit
// this file — PricingPage.tsx never hardcodes a number.
export interface PricingTier {
  id: string;
  name: string;
  tagline: string;
  // TODO(product): set the real monthly price once pricing is finalized.
  priceLabel: string;
  companies: string;
  agents: string;
  history: string;
  teamMembers: string;
  features: string[];
  mostComplete?: boolean;
  ctaLabel: string;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: "solo",
    name: "Solo",
    tagline: "One idea, one company, real structure.",
    priceLabel: "—",
    companies: "1",
    agents: "Up to 5",
    history: "30 days",
    teamMembers: "Just you",
    features: [
      "Guided business interview",
      "Task discovery",
      "Org structure",
      "Approval system",
      "Spending controls",
      "Bring your own key",
      "Dashboard",
    ],
    ctaLabel: "Describe your idea",
  },
  {
    id: "company",
    name: "Company",
    tagline: "Run the whole operation with real controls.",
    priceLabel: "—",
    companies: "3",
    agents: "Up to 20",
    history: "12 months",
    teamMembers: "5",
    features: [
      "Everything in Solo",
      "Per-agent spending walls",
      "Agent activity log",
      "Daily & weekly digest",
      "Company charter",
      "Custom approval rules",
      "Multiple AI providers",
    ],
    mostComplete: true,
    ctaLabel: "Describe your idea",
  },
  {
    id: "scale",
    name: "Scale",
    tagline: "Multiple companies, delegated oversight.",
    priceLabel: "—",
    companies: "Unlimited",
    agents: "Unlimited",
    history: "Unlimited",
    teamMembers: "Unlimited",
    features: ["Everything in Company", "Team management & roles", "Delegated approvals", "Audit export", "Priority support"],
    ctaLabel: "Talk to us",
  },
];

// TODO(product): no sales-assist flow exists yet for the Scale tier — its
// CTA routes into the same idea box as Solo/Company (the only real
// onboarding path in the app today) rather than a fabricated "contact us"
// channel. Revisit once a real sales/contact flow exists.
