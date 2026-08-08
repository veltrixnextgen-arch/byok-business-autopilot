import { Link } from "@tanstack/react-router";
import { PRICING_TIERS } from "../../lib/pricingConstants";
import { cx } from "../ui";
import { FinalCta } from "./FinalCta";
import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";
import { AccordionItem, Reveal, RwCard, SectionContainer, SectionEyebrow, SectionHeading, useAccordion, useRevealOnScroll } from "./primitives";

// Built from the Emergent reference's real /pricing page (captured live
// 2026-08-08, full FAQ transcript in the PR body). One thing that made
// this page unusually easy to build honestly: the reference itself has no
// real prices either — every tier shows "—/month" and the page states
// outright that "Pricing not finalised. Values below are placeholders."
// So `priceLabel: "—"` (lib/pricingConstants.ts) isn't a guess dressed up
// as a real number — it's what's actually there, TODO(product)-flagged
// for whenever a real price is set.
const TIER_STAT_FIELDS = [
  { key: "companies" as const, label: "Companies" },
  { key: "agents" as const, label: "Agents" },
  { key: "history" as const, label: "History" },
  { key: "teamMembers" as const, label: "Team members" },
];

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

export function PricingPage() {
  const [heroRef, heroRevealed] = useRevealOnScroll<HTMLElement>();
  const [costRef, costRevealed] = useRevealOnScroll<HTMLElement>();
  const [faqRef, faqRevealed] = useRevealOnScroll<HTMLElement>();
  const [openFaq, toggleFaq] = useAccordion(0);

  return (
    <>
      <LandingNav />
      <SectionContainer ref={heroRef} className="pb-8 pt-32 sm:pt-40">
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

        <Reveal revealed={heroRevealed} delay={80} className="mx-auto mt-14 grid max-w-5xl gap-5 lg:grid-cols-3 lg:items-start">
          {PRICING_TIERS.map((tier) => (
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

              <p className="mt-6 font-display text-3xl font-semibold text-text">
                <span aria-hidden="true">{tier.priceLabel}</span>
                <span className="ml-1.5 text-sm font-normal text-text-muted">/month</span>
                <span className="sr-only">Pricing not yet finalized</span>
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
                Platform only · AI usage billed by your provider
              </p>

              <div className="mt-5 grid grid-cols-2 gap-2.5">
                {TIER_STAT_FIELDS.map((field) => (
                  <div key={field.key} className="rounded-lg border border-border-subtle bg-bg-glass-subtle px-3 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-muted">{field.label}</p>
                    <p className="mt-1 text-sm font-semibold text-text">{tier[field.key]}</p>
                  </div>
                ))}
              </div>

              <ul className="mt-6 flex-1 space-y-2.5">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-text-secondary">
                    <span className="mt-0.5 text-accent" aria-hidden="true">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

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
          ))}
        </Reveal>

        <Reveal revealed={heroRevealed} delay={160} className="mx-auto mt-6 max-w-5xl text-center">
          <p className="font-mono text-xs text-text-muted">Pricing not finalised. Values shown are placeholders.</p>
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
