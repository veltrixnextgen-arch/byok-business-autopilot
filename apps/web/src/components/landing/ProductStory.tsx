import { RwCard, SectionContainer, SectionEyebrow, SectionHeading } from "./primitives";

const ITEMS = [
  {
    number: "01",
    title: "And reverse-engineers your company.",
    body: "We work backwards from what the business must do — not from a template.",
  },
  {
    number: "02",
    title: "Every task, someone's job.",
    body: "Each discovered task is assigned to an agent with a name and a mandate.",
  },
  {
    number: "03",
    title: "A real org chart, built bottom-up.",
    body: "Departments exist because the work demanded them, not because org charts look like that.",
  },
] as const;

export function ProductStory() {
  return (
    <SectionContainer>
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <SectionEyebrow>Agents take ownership</SectionEyebrow>
        <SectionHeading>Then Runwisely freezes the chaos.</SectionHeading>
        <p className="text-text-secondary">
          Tasks stream into structure, group into teams, and turn into named agents. Nothing floats. Everything has an
          owner.
        </p>
      </div>
      <div className="mt-12 grid gap-5 sm:grid-cols-3">
        {ITEMS.map((item) => (
          <RwCard key={item.title}>
            <p className="font-mono text-sm text-text-muted">{item.number}</p>
            <h3 className="mt-3 font-display text-lg font-semibold text-text">{item.title}</h3>
            <p className="mt-2 text-sm text-text-secondary">{item.body}</p>
          </RwCard>
        ))}
      </div>
    </SectionContainer>
  );
}
