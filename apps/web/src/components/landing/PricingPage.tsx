import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { PRICING_TIERS } from "../../lib/pricingConstants";
import { cx } from "../ui";
import { FinalCta } from "./FinalCta";
import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";
import { AccordionItem, Reveal, RwCard, SectionContainer, SectionEyebrow, SectionHeading, useAccordion, useRevealOnScroll } from "./primitives";

// Real prices as of ADR-044 (docs/DECISIONS.md, 2026-08-26) — this page
// used to mirror the Emergent reference's own unfinished "—/month"
// placeholders (captured live 2026-08-08); that's no longer true, and this
// page no longer says otherwise. Annual is a flat 2 months free on every
// tier — lib/pricingConstants.ts's priceAnnualUsd already bakes that in,
// this file just formats it.
type BillingPeriod = "monthly" | "annual";

const FAQ = [
  {
    q: "What does AI usage cost?",
    a: "AI usage is billed by your own provider, based on how much your agents actually do. Runwisely shows you the running total and stops work at the walls you set.",
  },
  {
    q: "How does BYOK work?",
    a: "You connect your own AI provider key. Runwisely uses it to run your agents, and your provider bills you directly for that usage.",
  },
  {
    q: "Does Runwisely mark up AI usage?",
    a: "No. Usage runs on your key at your provider's rates. Runwisely charges only for the platform.",
  },
  {
    q: "Are there usage credits, or a cap I can run out of?",
    a: "No. There's no credit balance to burn through and no metered usage tier to bump into — your agents run at whatever pace your own AI provider key and your own spending walls allow.",
  },
  {
    q: "Does Runwisely act automatically, or do I review its work?",
    a: "Every scheduled task produces a draft, not an action. It lands in your review queue derived from your actual business — approving marks it reviewed; nothing sends, posts, or executes on its own.",
  },
  {
    q: "Can I set spending limits?",
    a: "Yes — a company-wide daily wall, per-agent limits, and hard locks on money movement. Agents stop when a wall is reached.",
  },
  {
    q: "Can I cancel?",
    a: "Yes, at any time. Your company structure and history stay exportable.",
  },
  {
    q: "Can I change AI providers?",
    a: "Yes. You can switch providers or assign different models per agent at any time.",
  },
];

// Annual is shown as its OWN discounted monthly rate (the big number),
// with the real annual total in small text beneath — never as a lump
// "$/year" figure. That's the number a buyer actually compares against
// the monthly price, and it's what makes annual read as cheaper rather
// than as a bigger up-front commitment. The effective rate is always
// derived from priceAnnualUsd/12, never hand-typed, so it can't drift
// from the annual total actually charged.
function formatPrice(
  tier: (typeof PRICING_TIERS)[number],
  period: BillingPeriod,
): { amount: string; suffix: string; annualNote: string | null } {
  if (period === "annual") {
    const effectiveMonthly = tier.priceAnnualUsd / 12;
    return {
      amount: `$${effectiveMonthly.toFixed(2)}`,
      suffix: "/month",
      annualNote: `$${tier.priceAnnualUsd.toLocaleString()} billed annually · 2 months free`,
    };
  }
  return { amount: `$${tier.priceMonthlyUsd}`, suffix: "/month", annualNote: null };
}

export function PricingPage() {
  const [heroRef, heroRevealed] = useRevealOnScroll<HTMLElement>();
  const [costRef, costRevealed] = useRevealOnScroll<HTMLElement>();
  const [faqRef, faqRevealed] = useRevealOnScroll<HTMLElement>();
  const [openFaq, toggleFaq] = useAccordion(0);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");

  return (
    <>
      <LandingNav />
      <SectionContainer ref={heroRef} className="pb-8 pt-32 sm:pt-40 lg:pt-40">
        <Reveal revealed={heroRevealed} className="mx-auto max-w-3xl space-y-4 text-center">
          <SectionEyebrow>Pricing</SectionEyebrow>
          <h1 className="font-display text-3xl font-semibold leading-[1.08] tracking-tight sm:text-4xl lg:text-[52px]">
            <span className="text-text">You pay Runwisely for the operating system.</span>
            <br />
            <span className="bg-gradient-to-br from-accent-strong to-cta-warm bg-clip-text text-transparent">
              You pay your AI provider for the intelligence.
            </span>
          </h1>
          <p className="text-text-secondary">Two separate bills, both visible. Runwisely never marks up AI usage.</p>
        </Reveal>

        <Reveal revealed={heroRevealed} delay={40} className="mx-auto mt-8 grid max-w-3xl gap-4 text-left sm:grid-cols-2">
          <div className="rounded-xl border border-border-subtle bg-bg-glass-subtle px-4 py-3.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">No credit caps</p>
            <p className="mt-1.5 text-sm text-text-secondary">
              No credit balance to run out of, no metered usage tier. Your agents run at your own AI provider's rates and your
              own spending walls — never ours.
            </p>
          </div>
          <div className="rounded-xl border border-border-subtle bg-bg-glass-subtle px-4 py-3.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">Drafts, not actions</p>
            <p className="mt-1.5 text-sm text-text-secondary">
              Every scheduled task is contextual work derived from your business, put in front of you to review — not
              executed automatically. Approving marks it reviewed.
            </p>
          </div>
        </Reveal>

        <Reveal revealed={heroRevealed} delay={80} className="mx-auto mt-10 flex justify-center">
          <div className="inline-flex rounded-full border border-border-subtle bg-bg-glass-subtle p-1">
            {(["monthly", "annual"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                aria-pressed={period === option}
                className={cx(
                  "rounded-full px-4 py-1.5 font-display text-sm font-medium transition-colors",
                  period === option ? "bg-gradient-to-br from-accent-strong to-cta-warm text-[#120c22]" : "text-text-secondary",
                )}
              >
                {option === "monthly" ? "Monthly" : "Annual — 2 months free"}
              </button>
            ))}
          </div>
        </Reveal>

        <Reveal revealed={heroRevealed} delay={120} className="mx-auto mt-8 grid max-w-5xl gap-5 lg:grid-cols-3 lg:items-start">
          {PRICING_TIERS.map((tier) => {
            const price = formatPrice(tier, period);
            return (
              <div
                key={tier.id}
                className={cx(
                  "relative flex h-full flex-col rounded-[18px] border p-6",
                  tier.mostComplete ? "border-accent/40 bg-white/[0.05] lg:-translate-y-3" : "border-white/[0.08] bg-white/[0.035]",
                )}
              >
                {tier.mostComplete && (
                  <span className="absolute -top-3 left-6 rounded-full border border-accent/50 bg-bg px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
                    Most complete
                  </span>
                )}
                <h2 className="font-display text-xl font-semibold text-text">{tier.name}</h2>
                <p className="mt-1.5 text-sm text-text-secondary">{tier.tagline}</p>

                {tier.leadWithCadence && (
                  <p className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
                    ⚡ {tier.cadenceLabel} cadence
                  </p>
                )}

                <p className={cx("font-display text-3xl font-semibold text-text", tier.leadWithCadence ? "mt-3" : "mt-6")}>
                  {price.amount}
                  <span className="ml-1.5 text-sm font-normal text-text-muted">{price.suffix}</span>
                </p>
                {price.annualNote && <p className="mt-1 text-xs text-text-muted">{price.annualNote}</p>}
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
                  Platform only · AI usage billed by your provider
                </p>

                <p className="mt-5 text-sm leading-relaxed text-text-secondary">{tier.stats.join(" · ")}</p>

                <div className="mt-5 flex-1 border-t border-border-subtle pt-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">{tier.featuresLabel}</p>
                  <ul className="mt-2.5 space-y-2.5">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm text-text-secondary">
                        <span className="mt-0.5 text-accent" aria-hidden="true">
                          ✓
                        </span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>

                <Link
                  to="/"
                  className={cx(
                    "mt-6 inline-flex w-full items-center justify-center rounded-full px-5 py-2.5 font-display text-sm font-medium transition-transform duration-landing-button ease-landing hover:-translate-y-px",
                    tier.mostComplete
                      ? "bg-gradient-to-br from-accent-strong to-cta-warm text-[#120c22] shadow-glow-cta"
                      : "border border-border bg-bg-glass text-text hover:border-border-strong",
                  )}
                >
                  {tier.ctaLabel}
                </Link>
              </div>
            );
          })}
        </Reveal>
      </SectionContainer>

      <SectionContainer ref={costRef} className="py-16 lg:py-20">
        <Reveal revealed={costRevealed} className="grid gap-5 sm:grid-cols-2">
          <RwCard>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Runwisely platform cost</p>
            <h3 className="mt-3 font-display text-xl font-semibold text-text">A predictable monthly fee.</h3>
            <p className="mt-2 text-sm text-text-secondary">
              Company structure, agents, approvals, spending walls, dashboards and history. It does not change with
              how hard your agents work.
            </p>
          </RwCard>
          <RwCard>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">AI usage cost</p>
            <h3 className="mt-3 font-display text-xl font-semibold text-text">Whatever your provider charges.</h3>
            <p className="mt-2 text-sm text-text-secondary">
              Billed directly to you on your own key, at your provider's rates. Runwisely shows the running total and
              stops work at your walls.
            </p>
          </RwCard>
        </Reveal>
      </SectionContainer>

      <SectionContainer ref={faqRef}>
        <Reveal revealed={faqRevealed} className="mx-auto max-w-2xl space-y-3 text-center">
          <SectionEyebrow>Questions</SectionEyebrow>
          <SectionHeading>Straight answers.</SectionHeading>
        </Reveal>
        <Reveal revealed={faqRevealed} delay={80} className="mx-auto mt-10 max-w-2xl space-y-3">
          {FAQ.map((item, i) => (
            <AccordionItem key={item.q} isOpen={openFaq === i} onToggle={() => toggleFaq(i)} title={item.q}>
              <p className="text-sm text-text-secondary sm:text-base">{item.a}</p>
            </AccordionItem>
          ))}
        </Reveal>
      </SectionContainer>

      <FinalCta />
      <LandingFooter />
    </>
  );
}
