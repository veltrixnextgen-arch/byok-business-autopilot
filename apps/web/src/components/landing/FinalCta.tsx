import { IdeaForm } from "./IdeaForm";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden px-5 py-28 sm:px-8 lg:py-40">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid-hairline opacity-40" />
      <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-8 text-center">
        <h2 className="font-display text-3xl font-semibold leading-[1.08] tracking-tight text-text sm:text-4xl lg:text-[52px]">
          Describe the idea.
          <br />
          Meet the company.
        </h2>
        <IdeaForm buttonLabel="Build my company" className="max-w-xl" />
        <p className="font-mono text-xs text-text-muted">No credit card · your own AI key · at cost</p>
      </div>
    </section>
  );
}
