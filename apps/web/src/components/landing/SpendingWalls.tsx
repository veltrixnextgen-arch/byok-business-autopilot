import { RwCard, SectionContainer, SectionEyebrow, SectionHeading } from "./primitives";

// Illustrative only — the spend-wall gate this depicts is a real
// trust-core surface (packages/cost-gate, MVP-1) exposed to the user for
// the first time here, not yet wired into any live apps/web screen.
const STATS = [
  { label: "Daily AI spend", value: "$3.74", suffix: "/ $10.00" },
  { label: "Agent limit", value: "$1.00", suffix: null },
  { label: "Company limit", value: "$15.00", suffix: "/day" },
  { label: "Payment authority", value: "Locked", suffix: null },
] as const;

export function SpendingWalls() {
  return (
    <SectionContainer>
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
        <div className="order-2 grid grid-cols-2 gap-4 lg:order-1">
          {STATS.map((stat) => (
            <RwCard key={stat.label}>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">{stat.label}</p>
              <p className="mt-2 font-display text-2xl font-semibold text-text">
                {stat.value}
                {stat.suffix && <span className="ml-1 text-sm font-normal text-text-muted">{stat.suffix}</span>}
              </p>
            </RwCard>
          ))}
        </div>
        <div className="order-1 space-y-4 lg:order-2">
          <SectionEyebrow>Spending walls</SectionEyebrow>
          <SectionHeading>
            AI agents can act.
            <br />
            Your walls decide how far.
          </SectionHeading>
          <p className="text-text-secondary">
            Set a company-wide daily ceiling and per-agent limits. When a wall is reached, work stops and you are
            told — before the bill, not after.
          </p>
        </div>
      </div>
    </SectionContainer>
  );
}
