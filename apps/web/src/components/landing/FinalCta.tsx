import { IdeaForm } from "./IdeaForm";
import { Reveal, useRevealOnScroll } from "./primitives";

export function FinalCta() {
  const [ref, revealed] = useRevealOnScroll<HTMLElement>();

  return (
    <section ref={ref} className="relative overflow-hidden px-5 py-28 sm:px-8 lg:py-40">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid-hairline opacity-40" />
      <div
        aria-hidden="true"
        className="rw-breathe pointer-events-none absolute left-1/2 top-1/2 size-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-strong/20 blur-[100px]"
      />
      <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-8 text-center">
        <Reveal revealed={revealed}>
          <h2 className="font-display text-3xl font-semibold leading-[1.08] tracking-tight text-text sm:text-4xl lg:text-[52px]">
            Describe the idea.
            <br />
            Meet the company.
          </h2>
        </Reveal>
        <Reveal revealed={revealed} delay={80} className="w-full max-w-xl">
          <IdeaForm buttonLabel="Build my company" />
        </Reveal>
        <Reveal revealed={revealed} delay={160}>
          <p className="font-mono text-xs text-text-muted">Your own AI key, at cost · no markup on AI</p>
        </Reveal>
      </div>
    </section>
  );
}
