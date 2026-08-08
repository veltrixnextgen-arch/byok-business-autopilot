import { AVATAR_RING_CLASSES, DOT_TONE_CLASSES } from "../../lib/teamHints";
import { cx } from "../ui";
import { FinalCta } from "./FinalCta";
import { IdeaForm } from "./IdeaForm";
import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";
import { AccordionItem, Reveal, RwCard, SectionContainer, SectionEyebrow, SectionHeading, useAccordion, useRevealOnScroll } from "./primitives";

// Built from the Emergent reference's real /how-it-works page (captured
// live 2026-08-08 by expanding every one of its 8 accordion steps — see
// the PR body for the full captured transcript). Two deliberate
// departures from a literal copy, both matching conventions this codebase
// already established elsewhere (ScrollSequence.tsx, InteractivePreview.tsx):
//
// 1. Team/example content uses our own real taxonomy (Money/Clients/
//    Marketing/Operations, lib/teamHints.ts) and InteractivePreview's own
//    first demo example, not the reference's own demo taxonomy or its
//    named personas (Maya, Ravi, ...) — those aren't part of our product.
// 2. The reference's per-step numbers that read as real product
//    performance/cost data (an agent's "$0.42/day", a dashboard's "$2.84
//    spend today") are NOT reproduced — inventing pricing-shaped numbers
//    for a page like this is exactly what this phase's brief ruled out.
//    Non-monetary illustrative counts are kept (they're clearly a demo
//    walkthrough of one example idea, not a claim about a real account).

const EXAMPLE_IDEA = "A subscription-based meal prep company in Vancouver.";
// Same first example as InteractivePreview.tsx's EXAMPLES array — reusing
// its literal idea/task/team text on purpose, so a visitor who lands on
// both pages sees one consistent demo, not two different ones.
const EXAMPLE_TASKS = ["Marketing", "Order management", "Customer support", "Supplier coordination", "Bookkeeping", "Retention", "Social media", "Scheduling"];
const EXAMPLE_TEAMS: Array<"Marketing" | "Operations" | "Money" | "Clients"> = ["Marketing", "Operations", "Money", "Clients"];
const TEAM_TONE: Record<string, "money" | "clients" | "marketing" | "operations"> = {
  Money: "money",
  Clients: "clients",
  Marketing: "marketing",
  Operations: "operations",
};

const INTERVIEW_QUESTIONS = ["Who pays you?", "How do customers pay you?", "How do customers buy?", "What are you delivering?"];

const RULE_ROWS = [
  { agent: "Marketing Agent", action: "Email drafting", status: "AUTO" as const },
  { agent: "Finance Agent", action: "Customer refunds", status: "APPROVAL REQUIRED" as const },
  { agent: "Finance Agent", action: "Sending payments", status: "LOCKED" as const },
];
const RULE_STATUS_CLASSES: Record<(typeof RULE_ROWS)[number]["status"], string> = {
  AUTO: "border-operations/40 bg-operations/10 text-operations",
  "APPROVAL REQUIRED": "border-money/40 bg-money/10 text-money",
  LOCKED: "border-danger/40 bg-danger/10 text-danger",
};

const PROVIDERS = ["Anthropic", "OpenAI", "Google"];

// Small integer counts only — no dollar figures (see file-level note).
// "Spend today" stays non-numeric on purpose: the feature (a live,
// wall-enforced running total) is real, a specific number isn't.
const RUN_STATS = [
  { label: "Agents active", value: "6" },
  { label: "Work completed today", value: "22" },
  { label: "Spend today", value: "Tracked live" },
  { label: "Approvals waiting", value: "2" },
];

function StepNumber({ n }: { n: number }) {
  return <span className="shrink-0 font-mono text-sm text-text-muted">{String(n).padStart(2, "0")}</span>;
}

export function HowItWorksPage() {
  const [heroRef, heroRevealed] = useRevealOnScroll<HTMLElement>();
  const [openIndex, toggle] = useAccordion(0);
  const [resultRef, resultRevealed] = useRevealOnScroll<HTMLElement>();

  return (
    <>
      <LandingNav />
      <SectionContainer ref={heroRef} className="pb-8 pt-32 sm:pt-40">
        <Reveal revealed={heroRevealed} className="mx-auto max-w-2xl space-y-4 text-center">
          <SectionEyebrow>How it works</SectionEyebrow>
          <SectionHeading>
            From idea to{" "}
            <span className="bg-gradient-to-br from-accent-strong to-cta-warm bg-clip-text text-transparent">operating company.</span>
          </SectionHeading>
          <p className="text-text-secondary">
            Runwisely discovers what your business needs, organizes the work, and builds an AI-powered company around
            you.
          </p>
          <p className="font-mono text-xs text-text-muted">8 steps · Under 5 minutes · No business plan required</p>
        </Reveal>

        <Reveal revealed={heroRevealed} delay={80} className="mx-auto mt-12 max-w-2xl space-y-3">
          <AccordionItem isOpen={openIndex === 0} onToggle={() => toggle(0)} title="Describe the idea" prefix={<StepNumber n={1} />}>
            <div className="space-y-4">
              <p className="text-text-secondary">One or two sentences. No forms, no business plan.</p>
              <RwCard className="space-y-1 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Idea</p>
                <p className="font-display text-base font-medium text-text">&ldquo;{EXAMPLE_IDEA}&rdquo;</p>
              </RwCard>
              <IdeaForm buttonLabel="Meet your company →" placeholder={EXAMPLE_IDEA} />
            </div>
          </AccordionItem>

          <AccordionItem
            isOpen={openIndex === 1}
            onToggle={() => toggle(1)}
            title="Runwisely understands the business"
            prefix={<StepNumber n={2} />}
          >
            <div className="space-y-4">
              <p className="text-text-secondary">
                A short guided interview: who pays you, how customers buy, what you deliver, where you operate.
              </p>
              <ol className="space-y-2">
                {INTERVIEW_QUESTIONS.map((q, i) => (
                  <li key={q} className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-glass-subtle px-3.5 py-2.5 text-sm text-text">
                    <span className="font-mono text-xs text-text-muted">{String(i + 1).padStart(2, "0")}</span>
                    {q}
                  </li>
                ))}
              </ol>
            </div>
          </AccordionItem>

          <AccordionItem isOpen={openIndex === 2} onToggle={() => toggle(2)} title="Runwisely discovers the work" prefix={<StepNumber n={3} />}>
            <div className="space-y-4">
              <p className="text-text-secondary">Your answers become a concrete list of everything the business needs done.</p>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Work discovered</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {EXAMPLE_TASKS.map((task) => (
                    <span key={task} className="rounded-full border border-border-subtle bg-bg-glass-subtle px-3 py-1 text-xs text-text-muted">
                      {task}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem isOpen={openIndex === 3} onToggle={() => toggle(3)} title="Work becomes teams" prefix={<StepNumber n={4} />}>
            <div className="space-y-4">
              <p className="text-text-secondary">Related tasks cluster into departments with clear ownership.</p>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Your company</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {EXAMPLE_TEAMS.map((team) => {
                    const tone = TEAM_TONE[team];
                    return (
                      <span
                        key={team}
                        className={cx(
                          "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em]",
                          AVATAR_RING_CLASSES[tone],
                        )}
                      >
                        <span className={cx("size-1.5 rounded-full", DOT_TONE_CLASSES[tone])} aria-hidden="true" />
                        {team}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem isOpen={openIndex === 4} onToggle={() => toggle(4)} title="Teams receive agents" prefix={<StepNumber n={5} />}>
            <div className="space-y-4">
              <p className="text-text-secondary">Each team gets named agents with a role, responsibilities, and an AI brain.</p>
              <RwCard className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={cx(
                        "flex size-9 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold",
                        AVATAR_RING_CLASSES.marketing,
                      )}
                      aria-hidden="true"
                    >
                      MA
                    </span>
                    <div>
                      <p className="text-sm font-medium text-text">Marketing Agent</p>
                      <p className="text-xs text-text-muted">Campaign planning · Content calendar · Performance review</p>
                    </div>
                  </div>
                  <span className={cx("shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em]", RULE_STATUS_CLASSES.AUTO)}>
                    AUTO
                  </span>
                </div>
                <p className="border-t border-border-subtle pt-3 text-xs text-text-muted">
                  AI cost shown per agent, billed at your provider's rate — no Runwisely markup.
                </p>
              </RwCard>
            </div>
          </AccordionItem>

          <AccordionItem isOpen={openIndex === 5} onToggle={() => toggle(5)} title="You set the rules" prefix={<StepNumber n={6} />}>
            <div className="space-y-4">
              <p className="text-text-secondary">Autonomy, approvals, spending walls and who may talk to customers.</p>
              <RwCard className="space-y-3 p-4">
                {RULE_ROWS.map((row) => (
                  <div
                    key={`${row.agent}-${row.action}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-glass-subtle px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-text">{row.agent}</p>
                      <p className="text-xs text-text-muted">{row.action}</p>
                    </div>
                    <span className={cx("shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em]", RULE_STATUS_CLASSES[row.status])}>
                      {row.status}
                    </span>
                  </div>
                ))}
              </RwCard>
            </div>
          </AccordionItem>

          <AccordionItem isOpen={openIndex === 6} onToggle={() => toggle(6)} title="Connect your AI" prefix={<StepNumber n={7} />}>
            <div className="space-y-4">
              <p className="text-text-secondary">Bring your own provider key. Usage is billed to you at cost.</p>
              <RwCard className="space-y-2.5 p-4">
                {PROVIDERS.map((provider) => (
                  <div key={provider} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-glass-subtle px-4 py-2.5">
                    <span className="text-sm text-text">{provider}</span>
                    <span className="font-mono text-xs text-text-muted">sk-•••••••</span>
                  </div>
                ))}
                <p className="pt-1 text-xs text-text-muted">At cost. No AI markup.</p>
              </RwCard>
            </div>
          </AccordionItem>

          <AccordionItem isOpen={openIndex === 7} onToggle={() => toggle(7)} title="Run the company" prefix={<StepNumber n={8} />}>
            <div className="space-y-4">
              <p className="text-text-secondary">A calm dashboard, an approval queue and a daily briefing.</p>
              <div className="grid grid-cols-2 gap-3">
                {RUN_STATS.map((stat) => (
                  <div key={stat.label} className="rounded-lg border border-border-subtle bg-bg-glass-subtle px-3.5 py-3">
                    <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-muted">{stat.label}</p>
                    <p className="mt-1 font-display text-lg font-semibold text-text">{stat.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </AccordionItem>
        </Reveal>
      </SectionContainer>

      <SectionContainer ref={resultRef}>
        <Reveal revealed={resultRevealed} className="mx-auto max-w-2xl space-y-3 text-center">
          <SectionEyebrow>The result</SectionEyebrow>
          <SectionHeading>Departments that exist because the work demanded them.</SectionHeading>
        </Reveal>
        <Reveal revealed={resultRevealed} delay={80} className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {EXAMPLE_TEAMS.map((team) => {
            const tone = TEAM_TONE[team];
            return (
              <RwCard key={team} className="space-y-2">
                <span
                  className={cx("flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em]", AVATAR_RING_CLASSES[tone])}
                >
                  <span className={cx("size-1.5 rounded-full", DOT_TONE_CLASSES[tone])} aria-hidden="true" />
                  {team}
                </span>
                <p className="text-sm text-text-secondary">{team} Agent</p>
              </RwCard>
            );
          })}
        </Reveal>
      </SectionContainer>

      <FinalCta />
      <LandingFooter />
    </>
  );
}
