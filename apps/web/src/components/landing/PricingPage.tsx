import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { BILLING_PERIODS, PLAN, type BillingPeriodOption } from "../../lib/pricingConstants";
import { cx } from "../ui";
import { FinalCta } from "./FinalCta";
import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";
import { AccordionItem, Reveal, RwCard, SectionContainer, SectionEyebrow, SectionHeading, useAccordion, useRevealOnScroll } from "./primitives";

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

// The effective monthly rate is the big number (the figure a buyer
// actually compares against the plain monthly price), with the real
// billed total in small text beneath — never a lump "$/quarter" or
// "$/year" figure. Always derived from BILLING_PERIODS' own billedUsd,
// never hand-typed, so it can't drift from what Stripe actually charges.
function formatPrice(option: BillingPeriodOption): { amount: string; suffix: string; billedNote: string | null } {
  if (option.id === "monthly") {
    return { amount: `$${option.billedUsd}`, suffix: "/month", billedNote: null };
  }
  return {
    amount: `$${option.effectiveMonthlyUsd.toFixed(2)}`,
    suffix: "/month",
    billedNote: `$${option.billedUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} billed ${option.label.toLowerCase()} · save ${option.savePercent}%`,
  };
}

export function PricingPage() {
  const [heroRef, heroRevealed] = useRevealOnScroll<HTMLElement>();
  const [costRef, costRevealed] = useRevealOnScroll<HTMLElement>();
  const [faqRef, faqRevealed] = useRevealOnScroll<HTMLElement>();
  const [openFaq, toggleFaq] = useAccordion(0);
  const [periodId, setPeriodId] = useState<BillingPeriodOption["id"]>("monthly");
  const period = BILLING_PERIODS.find((p) => p.id === periodId) ?? BILLING_PERIODS[0];
  const price = formatPrice(period);

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
            {BILLING_PERIODS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPeriodId(option.id)}
                aria-pressed={periodId === option.id}
                className={cx(
                  "rounded-full px-4 py-1.5 font-display text-sm font-medium transition-colors",
                  periodId === option.id ? "bg-gradient-to-br from-accent-strong to-cta-warm text-[#120c22]" : "text-text-secondary",
                )}
              >
                {option.label}
                {option.savePercent ? ` — save ${option.savePercent}%` : ""}
              </button>
            ))}
          </div>
        </Reveal>

        <Reveal revealed={heroRevealed} delay={120} className="mx-auto mt-8 max-w-2xl">
          <div className="relative flex flex-col rounded-[18px] border border-accent/40 bg-white/[0.05] p-8">
            <h2 className="font-display text-xl font-semibold text-text">{PLAN.name}</h2>
            <p className="mt-1.5 text-sm text-text-secondary">{PLAN.tagline}</p>

            <p className="mt-6 font-display text-4xl font-semibold text-text">
              {price.amount}
              <span className="ml-1.5 text-base font-normal text-text-muted">{price.suffix}</span>
            </p>
            {price.billedNote && <p className="mt-1 text-xs text-text-muted">{price.billedNote}</p>}
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
              Platform only · AI usage billed by your provider
            </p>

            <p className="mt-5 text-sm leading-relaxed text-text-secondary">{PLAN.stats.join(" · ")}</p>

            <div className="mt-5 flex-1 border-t border-border-subtle pt-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">Everything</p>
              <ul className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                {PLAN.features.map((feature) => (
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
              className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-gradient-to-br from-accent-strong to-cta-warm px-5 py-2.5 font-display text-sm font-medium text-[#120c22] shadow-glow-cta transition-transform duration-landing-button ease-landing hover:-translate-y-px"
            >
              {PLAN.ctaLabel}
            </Link>
          </div>
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
