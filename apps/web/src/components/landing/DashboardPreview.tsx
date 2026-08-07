import { Reveal, RwCard, SectionContainer, SectionEyebrow, SectionHeading, useRevealOnScroll } from "./primitives";

// Illustrative only — the operating dashboard this depicts is Phase B's
// eventual product surface (README's build order), not the Step-1
// placeholder that exists at /dashboard today. Same disclosed-demo
// convention as docs/design/reference.html.
const STATS = [
  { label: "Agents active", value: "9", suffix: "of 9 on duty" },
  { label: "Work completed today", value: "37", suffix: "tasks closed" },
  { label: "Spend today", value: "$2.84", suffix: "of $10.00 wall" },
  { label: "Approvals waiting", value: "3", suffix: "oldest 24m ago" },
] as const;

const ACTIVITY = [
  { initials: "MA", action: "Prepared campaign concepts", who: "Maya · Growth Lead", when: "12m" },
  { initials: "TH", action: "Reconciled yesterday's transactions", who: "Theo · Finance", when: "34m" },
  { initials: "NO", action: "Drafted response to refund request", who: "Nora · Customer Experience", when: "51m" },
  { initials: "OM", action: "Resolved two delivery exceptions", who: "Omar · Operations", when: "1h" },
] as const;

export function DashboardPreview() {
  const [ref, revealed] = useRevealOnScroll<HTMLElement>();

  return (
    <SectionContainer ref={ref}>
      <Reveal revealed={revealed} className="mx-auto max-w-2xl space-y-3 text-center">
        <SectionEyebrow>After setup</SectionEyebrow>
        <SectionHeading>A calm place to run a company.</SectionHeading>
        <p className="text-text-secondary">What is happening, what your agents did, what needs you, and what it cost.</p>
      </Reveal>

      <div className="mt-10 grid gap-4 sm:grid-cols-4">
        {STATS.map((stat, i) => (
          <Reveal key={stat.label} revealed={revealed} delay={80 + i * 80}>
            <RwCard>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">{stat.label}</p>
              <p className="mt-2 font-display text-3xl font-semibold text-text">{stat.value}</p>
              <p className="mt-1 text-xs text-text-muted">{stat.suffix}</p>
            </RwCard>
          </Reveal>
        ))}
      </div>

      <Reveal revealed={revealed} delay={400}>
        <RwCard className="mt-6">
          <ul className="divide-y divide-border-subtle">
            {ACTIVITY.map((item) => (
              <li key={item.who} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-accent/50 bg-accent/15 font-display text-xs font-semibold text-accent">
                  {item.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text">{item.action}</p>
                  <p className="text-xs text-text-muted">{item.who}</p>
                </div>
                <span className="shrink-0 font-mono text-xs text-text-muted">{item.when}</span>
              </li>
            ))}
          </ul>
        </RwCard>
      </Reveal>
    </SectionContainer>
  );
}
