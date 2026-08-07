import { useState } from "react";
import { AVATAR_RING_CLASSES, DOT_TONE_CLASSES } from "../../lib/teamHints";
import { cx } from "../ui";
import { RwCard, SectionContainer, SectionEyebrow, SectionHeading } from "./primitives";

// Illustrative demo examples only — same convention as docs/design/
// reference.html and reference.html's own three demo businesses: none of
// this is real extraction output, and it never becomes any.
const EXAMPLES = [
  {
    label: "Local business",
    idea: "A subscription-based meal prep company in Vancouver.",
    tasks: ["Marketing", "Order management", "Customer support", "Supplier coordination", "Bookkeeping", "Retention", "Social media", "Scheduling"],
    teams: ["Growth", "Operations", "Finance", "Customer Experience", "Product"],
  },
  {
    label: "SaaS company",
    idea: "A time-tracking tool for freelance designers.",
    tasks: ["Onboarding emails", "Bug triage", "Billing disputes", "Feature requests", "Churn follow-up", "Release notes", "Support tickets"],
    teams: ["Growth", "Engineering", "Finance", "Customer Experience"],
  },
  {
    label: "Agency",
    idea: "A five-person branding studio taking on retainer clients.",
    tasks: ["Client proposals", "Invoicing", "Project scheduling", "Asset delivery", "Contract renewals", "Vendor payments"],
    teams: ["Growth", "Operations", "Finance"],
  },
  {
    label: "E-commerce",
    idea: "A handmade candle shop selling online and at markets.",
    tasks: ["Inventory counts", "Order packing", "Return requests", "Ad spend tracking", "Supplier orders", "Market scheduling"],
    teams: ["Growth", "Operations", "Finance", "Customer Experience"],
  },
  {
    label: "Creator business",
    idea: "A newsletter writer selling a paid subscriber tier.",
    tasks: ["Subscriber support", "Sponsorship outreach", "Content calendar", "Payment reconciliation", "Renewal reminders"],
    teams: ["Growth", "Finance", "Customer Experience"],
  },
] as const;

const TONE_CYCLE = ["money", "clients", "marketing", "operations"] as const;

export function InteractivePreview() {
  const [activeIndex, setActiveIndex] = useState(0);
  const example = EXAMPLES[activeIndex];

  return (
    <SectionContainer>
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <SectionEyebrow>Interactive preview</SectionEyebrow>
        <SectionHeading>Watch it happen on a real idea.</SectionHeading>
        <p className="text-text-secondary">Pick an example and see what Runwisely discovers. These are demo examples.</p>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        {EXAMPLES.map((ex, i) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => setActiveIndex(i)}
            aria-pressed={i === activeIndex}
            className={cx(
              "rounded-full border px-4 py-2 font-body text-sm transition-colors duration-calm-fast ease-calm",
              i === activeIndex
                ? "border-accent/50 bg-accent/15 text-accent"
                : "border-border bg-bg-glass text-text-secondary hover:border-border-strong hover:text-text",
            )}
          >
            {ex.label}
          </button>
        ))}
      </div>

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
          {example.teams.map((team, i) => {
            const tone = TONE_CYCLE[i % TONE_CYCLE.length];
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
    </SectionContainer>
  );
}
