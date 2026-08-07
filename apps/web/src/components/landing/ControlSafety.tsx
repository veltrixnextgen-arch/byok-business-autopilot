import { Reveal, RwCard, SectionContainer, SectionEyebrow, SectionHeading, useRevealOnScroll } from "./primitives";

const RULES = ["Approval rules", "Daily spend limits", "Payment permissions", "Customer-contact permissions"] as const;

// Illustrative only — the approval queue and permission model these
// depict are real product surfaces from master-plan-v2.md's MVP-1/2
// ladder, not yet built in apps/web. Same disclosed-demo convention as
// docs/design/reference.html.
const PERMISSION_ROWS = [
  { agent: "Marketing Agent", action: "Email Drafting", status: "AUTO" as const },
  { agent: "Finance Agent", action: "Customer Refunds", status: "APPROVAL REQUIRED" as const },
  { agent: "Finance Agent", action: "Sending Payments", status: "LOCKED" as const },
] as const;

const STATUS_CLASSES: Record<(typeof PERMISSION_ROWS)[number]["status"], string> = {
  AUTO: "border-operations/40 bg-operations/10 text-operations",
  "APPROVAL REQUIRED": "border-money/40 bg-money/10 text-money",
  LOCKED: "border-danger/40 bg-danger/10 text-danger",
};

export function ControlSafety() {
  const [ref, revealed] = useRevealOnScroll<HTMLElement>();

  return (
    <SectionContainer ref={ref}>
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
        <Reveal revealed={revealed} className="space-y-4">
          <SectionEyebrow>Control &amp; safety</SectionEyebrow>
          <SectionHeading>
            Your company works for you.
            <br />
            Not the other way around.
          </SectionHeading>
          <p className="text-text-secondary">
            Autonomy is a setting, not a leap of faith. Decide what each agent may do alone, what needs your
            signature, and what is simply not allowed.
          </p>
          <ul className="grid grid-cols-2 gap-2 pt-2">
            {RULES.map((rule) => (
              <li key={rule} className="flex items-center gap-2 text-sm text-text-secondary">
                <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {rule}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal revealed={revealed} delay={80}>
          <RwCard className="space-y-3">
            {PERMISSION_ROWS.map((row) => (
              <div
                key={`${row.agent}-${row.action}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-glass-subtle px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-text">{row.agent}</p>
                  <p className="text-xs text-text-muted">{row.action}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${STATUS_CLASSES[row.status]}`}>
                  {row.status}
                </span>
              </div>
            ))}
          </RwCard>
        </Reveal>
      </div>
    </SectionContainer>
  );
}
