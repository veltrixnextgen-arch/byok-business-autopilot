import { useEffect, useRef, useState } from "react";
import { AVATAR_RING_CLASSES, DOT_TONE_CLASSES } from "../../lib/teamHints";
import { cx } from "../ui";

// The core narrative (approved for full build-out): idea -> tasks -> teams
// -> agents -> company, matching how extraction actually works bottom-up
// (master-plan-v2.md) — not generic marketing filler. Original copy in
// our own voice, same principle as LandingStory's Acts and reference.html
// itself: the reference's VISUAL mechanism (a scroll-pinned step sequence)
// is what's being reproduced here, not scraped copy — this session's
// browser tooling couldn't drive real scroll events against the
// reference's client-rendered SPA to read its own step 2-6 text, so
// steps 2-6 are original, step 1's wording matches what was directly
// observed.
const STEPS = [
  {
    label: "One idea",
    heading: "You have the idea.",
    body: "One founder. One sentence. Nothing else exists yet.",
    chips: ["Your idea"],
  },
  {
    label: "Tasks discovered",
    heading: "It breaks into tasks.",
    body: "Every job the business actually needs, named individually — not guessed at.",
    chips: ["Reply to messages", "Send invoices", "Post updates", "Track inventory"],
  },
  {
    label: "Teams form",
    heading: "Tasks cluster into teams.",
    body: "Related work finds its department — money, clients, marketing, operations.",
    chips: ["Money", "Clients", "Marketing", "Operations"],
  },
  {
    label: "Agents named",
    heading: "Each team gets its agents.",
    body: "Every task has an owner with a name, not a queue nobody's watching.",
    chips: ["Agent · Invoicing", "Agent · Support", "Agent · Content", "Agent · Ordering"],
  },
  {
    label: "A lead emerges",
    heading: "A lead ties each team together.",
    body: "One role per team, assembled last from what its agents actually do, reporting straight to you.",
    chips: ["Money Lead", "Clients Lead", "Marketing Lead", "Operations Lead"],
  },
  {
    label: "Company assembled",
    heading: "Your company exists.",
    body: "Structure first. Everything after — approvals, spend, the dashboard — runs through it.",
    chips: ["Your company"],
  },
] as const;

const TONES = ["money", "clients", "marketing", "operations"] as const;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  return reduced;
}

export function ScrollSequence() {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(0);
  const tickingRef = useRef(false);

  useEffect(() => {
    if (reducedMotion) return;

    function computeStep() {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const progress = total > 0 ? Math.min(Math.max(-rect.top / total, 0), 1) : 0;
      setActiveStep(Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length)));
    }

    function onScroll() {
      if (tickingRef.current) return;
      tickingRef.current = true;
      requestAnimationFrame(() => {
        computeStep();
        tickingRef.current = false;
      });
    }

    computeStep();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [reducedMotion]);

  // A reduced-motion visitor never gets the scroll-pinned mechanic at
  // all — just the same six steps as a plain stacked, static list. No
  // scroll-jacking, nothing to disorient, nothing timed.
  if (reducedMotion) {
    return (
      <section className="mx-auto max-w-[1200px] space-y-10 px-5 py-24 sm:px-8 lg:py-32">
        <SequenceEyebrow />
        {STEPS.map((step, i) => (
          <StepContent key={step.heading} step={step} index={i} />
        ))}
      </section>
    );
  }

  return (
    <section ref={containerRef} className="relative h-[420vh]">
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden pt-20 sm:pt-24">
        <div className="mx-auto w-full max-w-[1200px] px-5 sm:px-8">
          <SequenceEyebrow activeIndex={activeStep} />
          <StepContent step={STEPS[activeStep]} index={activeStep} />
        </div>
      </div>
    </section>
  );
}

function SequenceEyebrow({ activeIndex }: { activeIndex?: number }) {
  return (
    <p className="mb-4 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
      {activeIndex === undefined ? "Idea → tasks → teams → agents → company" : `Step ${activeIndex + 1} of ${STEPS.length}`}
    </p>
  );
}

function StepContent({ step, index }: { step: (typeof STEPS)[number]; index: number }) {
  return (
    <div key={step.heading} className="animate-[rise-in_var(--duration-ceremony-base)_var(--ease-ceremony)_both] text-center">
      <h3 className="font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">{step.heading}</h3>
      <p className="mx-auto mt-3 max-w-lg text-text-secondary">{step.body}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        {step.chips.map((chip, i) => {
          const tone = TONES[(index + i) % TONES.length];
          return (
            <span
              key={chip}
              className={cx(
                "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em]",
                AVATAR_RING_CLASSES[tone],
              )}
            >
              <span className={cx("size-1.5 rounded-full", DOT_TONE_CLASSES[tone])} aria-hidden="true" />
              {chip}
            </span>
          );
        })}
      </div>
    </div>
  );
}
