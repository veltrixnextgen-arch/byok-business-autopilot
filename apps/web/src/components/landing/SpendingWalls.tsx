import { Reveal, RwCard, SectionContainer, SectionEyebrow, SectionHeading, useRevealOnScroll } from "./primitives";

// Illustrative only — the spend-wall gate this depicts is a real
// trust-core surface (packages/cost-gate, MVP-1) exposed to the user for
// the first time here, not yet wired into any live apps/web screen.
const DAILY_SPEND = 3.74;
const DAILY_LIMIT = 10;

const SUB_STATS = [
  { label: "Agent limit", value: "$1.00" },
  { label: "Company limit", value: "$15.00/day" },
  { label: "Payment authority", value: "Locked" },
] as const;

export function SpendingWalls() {
  const [ref, revealed] = useRevealOnScroll<HTMLElement>();
  const fillPercent = Math.min(100, Math.round((DAILY_SPEND / DAILY_LIMIT) * 100));

  return (
    <SectionContainer ref={ref}>
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
        <Reveal revealed={revealed}>
          <RwCard>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Daily AI spend</p>
            <p className="mt-2 font-display text-3xl font-semibold text-text">
              ${DAILY_SPEND.toFixed(2)}
              <span className="ml-1 text-sm font-normal text-text-muted">/ ${DAILY_LIMIT.toFixed(2)}</span>
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={fillPercent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-gradient-to-r from-accent-strong to-cta-warm" style={{ width: `${fillPercent}%` }} />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {SUB_STATS.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-border-subtle bg-bg-glass-subtle px-3 py-2.5">
                  <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-muted">{stat.label}</p>
                  <p className="mt-1 text-sm font-semibold text-text">{stat.value}</p>
                </div>
              ))}
            </div>
          </RwCard>
        </Reveal>
        <Reveal revealed={revealed} delay={80} className="space-y-4">
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
        </Reveal>
      </div>
    </SectionContainer>
  );
}
