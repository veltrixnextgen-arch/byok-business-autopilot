import type { BadgeTone } from "../ui";
import { useEffect, useRef, useState } from "react";
import { AVATAR_RING_CLASSES, DOT_TONE_CLASSES } from "../../lib/teamHints";
import { cx } from "../ui";

// The core narrative: idea -> tasks -> teams -> agents -> company,
// matching how extraction actually works bottom-up (master-plan-v2.md).
// Copy for steps 1-6 matches the Emergent reference's own real copy,
// captured directly this time (a prior pass couldn't drive real scroll
// events against the reference's SPA and used placeholder text instead
// — see docs/design/reference-emergent.md for how this was confirmed).
// Chip content per step is original (task/agent examples), except step
// 4's chips, which are our own real team taxonomy (Money/Clients/
// Marketing/Operations) rather than the reference's own naming — kept
// consistent with InteractivePreview.tsx and with what real extraction
// actually produces.
const STEPS = [
  {
    label: "One idea",
    heading: "You have the idea.",
    body: "One founder. One sentence. Nothing else exists yet.",
    chips: ["Your idea"],
  },
  {
    label: "Work appears",
    heading: "But a company is hundreds of jobs.",
    body: "Work you never planned for starts appearing from every direction.",
    chips: ["Reply to messages", "Send invoices", "Post updates", "Track inventory"],
  },
  {
    label: "Runwisely finds the work",
    heading: "Runwisely finds the work.",
    body: "Every job the business actually needs is named and captured.",
    chips: ["Bookkeeping", "Scheduling", "Supplier orders", "Content"],
  },
  {
    label: "Teams form",
    heading: "Then builds the teams.",
    body: "Related work clusters into departments with real ownership.",
    chips: ["Money", "Clients", "Marketing", "Operations"],
  },
  {
    label: "Agents take ownership",
    heading: "Every task, someone's job.",
    body: "Named agents take responsibility for each task.",
    chips: ["Agent · Invoicing", "Agent · Support", "Agent · Content", "Agent · Ordering"],
  },
  {
    label: "Your company",
    heading: "Your company exists.",
    body: "Structure first. Everything after — approvals, spend, the dashboard — runs through it.",
    chips: ["Your company"],
  },
] as const;

const TONES: BadgeTone[] = ["money", "clients", "marketing", "operations"];
// Step 4's chips are literally the tone names — give them their own
// matching color instead of falling through the generic cycle below.
const TEAM_TONE: Record<string, BadgeTone> = { Money: "money", Clients: "clients", Marketing: "marketing", Operations: "operations" };

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
          <CrossfadeStep activeIndex={activeStep} />
          <StepProgress activeIndex={activeStep} total={STEPS.length} />
        </div>
      </div>
    </section>
  );
}

// The reference cross-fades between steps — old content visibly fading
// out while new content fades in, overlapping — rather than hard-cutting
// on step change. Newest layer renders in normal flow at full opacity
// immediately (its content is what should be visible); every older,
// still-fading layer stacks on top via absolute positioning and
// transitions its own opacity to 0, then gets pruned once the fade
// finishes. prefers-reduced-motion's global transition-duration
// override (tokens.css) collapses this to an effectively instant swap.
const CROSSFADE_MS = 700;

function CrossfadeStep({ activeIndex }: { activeIndex: number }) {
  const [layers, setLayers] = useState<{ id: number; step: number }[]>(() => [{ id: 0, step: activeIndex }]);
  const nextId = useRef(1);

  useEffect(() => {
    setLayers((prev) => {
      if (prev[prev.length - 1]?.step === activeIndex) return prev;
      return [...prev, { id: nextId.current++, step: activeIndex }];
    });
  }, [activeIndex]);

  useEffect(() => {
    if (layers.length <= 1) return;
    const timer = setTimeout(() => {
      setLayers((prev) => prev.slice(-1));
    }, CROSSFADE_MS);
    return () => clearTimeout(timer);
  }, [layers]);

  return (
    <div className="relative">
      {layers.map((layer, i) => {
        const isNewest = i === layers.length - 1;
        return (
          <div
            key={layer.id}
            aria-hidden={!isNewest}
            className={cx("transition-opacity duration-landing-entrance ease-landing", !isNewest && "absolute inset-0 top-0")}
            style={{ opacity: isNewest ? 1 : 0 }}
          >
            <StepContent step={STEPS[layer.step]} index={layer.step} />
          </div>
        );
      })}
    </div>
  );
}

function StepProgress({ activeIndex, total }: { activeIndex: number; total: number }) {
  return (
    <div className="mt-6 flex justify-center gap-2" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cx(
            "h-1 w-8 rounded-full transition-colors duration-landing-hover ease-landing",
            i <= activeIndex ? "bg-gradient-to-r from-accent-strong to-cta-warm" : "bg-white/10",
          )}
        />
      ))}
    </div>
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
    <div className="text-center">
      <h3 className="font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">{step.heading}</h3>
      <p className="mx-auto mt-3 max-w-lg text-text-secondary">{step.body}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        {step.chips.map((chip, i) => {
          const tone = TEAM_TONE[chip] ?? TONES[(index + i) % TONES.length];
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
