import { Link } from "@tanstack/react-router";
import { HeroPanel } from "./HeroPanel";
import { IdeaForm } from "./IdeaForm";
import { Reveal, useRevealOnMount } from "./primitives";

const RAIL_STEPS = ["Idea", "Tasks", "Teams", "Agents", "Company"] as const;

export function Hero() {
  const revealed = useRevealOnMount();

  return (
    <section className="relative overflow-hidden pb-16 pt-32 sm:pt-40 lg:pb-28 lg:pt-44">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid-hairline opacity-60 rw-breathe" />
      <div className="relative mx-auto grid max-w-[1200px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col items-center gap-8 text-center lg:items-start lg:text-left">
          <Reveal revealed={revealed}>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
              The operating system that builds the company
            </p>
          </Reveal>

          <Reveal revealed={revealed} delay={60}>
            <h1 className="max-w-3xl font-display text-4xl font-semibold leading-[1.05] tracking-tight text-text sm:text-5xl lg:text-[60px] lg:leading-[1]">
              You have the idea.
              <br />
              <span className="bg-gradient-to-br from-accent-strong to-cta-warm bg-clip-text text-transparent">Nobody handed you</span>
              <br />
              the company.
            </h1>
          </Reveal>

          <Reveal revealed={revealed} delay={140}>
            <p className="max-w-xl text-base leading-relaxed text-text-secondary">
              Runwisely turns your business idea into the work, teams, and AI agents required to operate it — so you can
              focus on the part only you can do.
            </p>
          </Reveal>

          <Reveal revealed={revealed} delay={220} className="w-full max-w-xl space-y-4">
            <IdeaForm buttonLabel="Meet your company →" />
            <Link
              to="/how-it-works"
              className="inline-block font-body text-sm text-text-secondary transition-colors duration-landing-hover ease-landing hover:text-text hover:underline hover:underline-offset-4"
            >
              See how it works
            </Link>
          </Reveal>

          <Reveal revealed={revealed} delay={300}>
            <p className="font-mono text-xs text-text-muted">Your own AI key, at cost · no markup on AI · walls against surprise bills</p>
          </Reveal>
        </div>

        <Reveal revealed={revealed} delay={140} className="w-full">
          <HeroPanel />
          <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.15em] text-text-muted">
            {RAIL_STEPS.join(" → ")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
