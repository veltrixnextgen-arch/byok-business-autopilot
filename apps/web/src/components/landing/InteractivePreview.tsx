import { useState } from "react";
import { AVATAR_RING_CLASSES, DOT_TONE_CLASSES } from "../../lib/teamHints";
import { cx } from "../ui";
import { Reveal, RwCard, SectionContainer, SectionEyebrow, SectionHeading, useRevealOnScroll } from "./primitives";

// Illustrative demo examples only — same convention as docs/design/
// reference.html and reference.html's own three demo businesses: none of
// this is real extraction output, and it never becomes any. Team names
// use our own real taxonomy (Money/Clients/Marketing/Operations, see
// lib/teamHints.ts) rather than the design reference's own demo taxonomy
// ("Growth"/"Product"/etc) — consistent with ScrollSequence.tsx and with
// what real extraction actually produces.
const EXAMPLES = [
  {
    label: "Local business",
    idea: "A subscription-based meal prep company in Vancouver.",
    tasks: ["Marketing", "Order management", "Customer support", "Supplier coordination", "Bookkeeping", "Retention", "Social media", "Scheduling"],
    teams: ["Marketing", "Operations", "Money", "Clients"],
  },
  {
    label: "SaaS company",
    idea: "A time-tracking tool for freelance designers.",
    tasks: ["Onboarding emails", "Bug triage", "Billing disputes", "Feature requests", "Churn follow-up", "Release notes", "Support tickets"],
    teams: ["Marketing", "Money", "Clients"],
  },
  {
    label: "Agency",
    idea: "A five-person branding studio taking on retainer clients.",
    tasks: ["Client proposals", "Invoicing", "Project scheduling", "Asset delivery", "Contract renewals", "Vendor payments"],
    teams: ["Marketing", "Operations", "Money"],
  },
  {
    label: "E-commerce",
    idea: "A handmade candle shop selling online and at markets.",
    tasks: ["Inventory counts", "Order packing", "Return requests", "Ad spend tracking", "Supplier orders", "Market scheduling"],
    teams: ["Marketing", "Operations", "Money", "Clients"],
  },
  {
    label: "Creator business",
    idea: "A newsletter writer selling a paid subscriber tier.",
    tasks: ["Subscriber support", "Sponsorship outreach", "Content calendar", "Payment reconciliation", "Renewal reminders"],
    teams: ["Marketing", "Money", "Clients"],
  },
] as const;

const TEAM_TONE: Record<string, "money" | "clients" | "marketing" | "operations"> = {
  Money: "money",
  Clients: "clients",
  Marketing: "marketing",
  Operations: "operations",
};

export function InteractivePreview() {
  const [ref, revealed] = useRevealOnScroll<HTMLElement>();
  const [activeIndex, setActiveIndex] = useState(0);
  const example = EXAMPLES[activeIndex];

  return (
    <SectionContainer ref={ref}>
      <Reveal revealed={revealed} className="mx-auto max-w-2xl space-y-3 text-center">
        <SectionEyebrow>Interactive preview</SectionEyebrow>
        <SectionHeading>Watch it happen on a real idea.</SectionHeading>
        <p className="text-text-secondary">Pick an example and see what Runwisely discovers. These are demo examples.</p>
      </Reveal>

      <Reveal revealed={revealed} delay={80} className="mt-8 flex flex-wrap items-center justify-center gap-2">
        {EXAMPLES.map((ex, i) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => setActiveIndex(i)}
            aria-pressed={i === activeIndex}
            className={cx(
              "rounded-full border px-4 py-2 font-body text-sm transition-colors duration-landing-hover ease-landing",
              i === activeIndex
                ? "border-accent/50 bg-accent/15 text-accent"
                : "border-border bg-bg-glass text-text-secondary hover:border-border-strong hover:text-text",
            )}
          >
            {ex.label}
          </button>
        ))}
      </Reveal>

      <Reveal revealed={revealed} delay={160}>
        <RwCard className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">The idea</p>
          <p className="mt-2 font-display text-xl font-semibold text-text">"{example.idea}"</p>

          <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Work discovered</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {example.tasks.map((task) => (
              <span key={task} className="rounded-full border border-border-subtle bg-bg-glass-subtle px-3 py-1 text-xs text-text-muted">
                {task}
              </span>
            ))}
          </div>

          <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Becomes teams</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {example.teams.map((team) => {
              const tone = TEAM_TONE[team];
              return (
                <span
                  key={team}
                  className={cx("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em]", AVATAR_RING_CLASSES[tone])}
                >
                  <span className={cx("size-1.5 rounded-full", DOT_TONE_CLASSES[tone])} aria-hidden="true" />
                  {team}
                </span>
              );
            })}
          </div>
        </RwCard>
      </Reveal>
    </SectionContainer>
  );
}
