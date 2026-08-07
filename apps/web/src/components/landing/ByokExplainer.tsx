import { Reveal, RwCard, SectionContainer, SectionEyebrow, SectionHeading, useRevealOnScroll } from "./primitives";

const STEPS = [
  { number: "01", title: "Runwisely", body: "Builds and runs the company structure." },
  { number: "02", title: "Your AI provider", body: "Supplies the intelligence your agents think with." },
  { number: "03", title: "Billed directly to you", body: "Usage appears on your provider's invoice, not ours." },
] as const;

export function ByokExplainer() {
  const [ref, revealed] = useRevealOnScroll<HTMLElement>();

  return (
    <SectionContainer ref={ref}>
      <Reveal revealed={revealed} className="mx-auto max-w-2xl space-y-3 text-center">
        <SectionEyebrow>Bring your own key</SectionEyebrow>
        <SectionHeading>Your team runs on your key.</SectionHeading>
        <p className="text-text-secondary">At cost. No AI markup. You control your provider and your bill.</p>
      </Reveal>
      <div className="mt-12 grid gap-5 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <Reveal key={step.title} revealed={revealed} delay={i * 80}>
            <RwCard>
              <p className="font-mono text-sm text-text-muted">{step.number}</p>
              <h3 className="mt-3 font-display text-lg font-semibold text-text">{step.title}</h3>
              <p className="mt-2 text-sm text-text-secondary">{step.body}</p>
            </RwCard>
          </Reveal>
        ))}
      </div>
    </SectionContainer>
  );
}
