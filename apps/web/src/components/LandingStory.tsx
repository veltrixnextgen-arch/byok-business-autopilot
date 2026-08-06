import type { ReactNode } from "react";
import { AVATAR_RING_CLASSES, DOT_TONE_CLASSES } from "../lib/teamHints";
import { useInViewReveal } from "../lib/useInViewReveal";
import { type BadgeTone, Card, cx } from "./ui";

// Acts I-IV of the pre-signup story (STEP 8), per docs/design/reference.html
// — the five-act scroll: idea -> overwhelm -> the org chart assembling
// bottom-up (the hero moment) -> the company running -> the existing idea
// input, which stays exactly as it was and becomes Act V. Per ADR-018 the
// reference's visual system is authoritative, its content is not — every
// label and name here is original copy, not the reference's own demo data.
//
// Motion: each act reveals once scrolled into view (useInViewReveal, an
// IntersectionObserver-backed sibling of OrgChartScreen's timer-driven
// useRevealStage — same pattern, different trigger), using the same
// animate-[keyframe_duration_easing_both] + animationDelay stagger already
// established there. No continuously-looping/scroll-scrubbed animation —
// deliberately, so there's nothing that can look janky on a mid-range
// phone; the "scroll-driven" part is *when* each act plays, not a
// frame-by-frame scroll-position mapping. Ceremony tier throughout
// (duration-ceremony-*), same register as the org-chart reveal itself.
// prefers-reduced-motion is handled entirely inside useInViewReveal: a
// reduced-motion visitor gets every act already revealed on mount, so the
// page reads as a normal static, scrollable sequence — never a blank or
// frozen section.

function ActEyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("font-mono text-xs uppercase tracking-[0.24em]", className)}>{children}</p>;
}

const ACT_I_CHIPS = [
  { label: "reply to a message", pos: "left-[6%] top-[18%] -rotate-3" },
  { label: "send the invoice", pos: "right-[8%] top-[26%] rotate-2" },
  { label: "restock the shelf", pos: "left-[10%] bottom-[20%] rotate-1" },
];

function ActI() {
  const [ref, revealed] = useInViewReveal<HTMLDivElement>();
  return (
    <section ref={ref} className="relative mx-auto flex min-h-[85vh] max-w-3xl flex-col items-center justify-center gap-5 overflow-hidden px-6 text-center">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden sm:block">
        {ACT_I_CHIPS.map((chip, i) => (
          <span
            key={chip.label}
            className={cx(
              "absolute rounded-full border border-border bg-bg-glass px-3 py-1.5 font-mono text-[11px] text-text-muted",
              chip.pos,
              revealed ? "animate-[fade-in_var(--duration-ceremony-slow)_var(--ease-ceremony)_both]" : "opacity-0",
            )}
            style={{ animationDelay: `${i * 140}ms` }}
          >
            {chip.label}
          </span>
        ))}
      </div>
      <ActEyebrow className="text-accent/75">Act I · The idea</ActEyebrow>
      <h2
        className={cx(
          "font-display text-4xl font-bold tracking-tight text-balance sm:text-6xl",
          revealed ? "animate-[rise-in_var(--duration-ceremony-base)_var(--ease-ceremony)_both]" : "opacity-0",
        )}
      >
        You have the idea.
        <br />
        <span className="text-text-muted">Nobody handed you a team to run it.</span>
      </h2>
      <p
        className={cx(
          "font-mono text-[11px] text-text-muted",
          revealed ? "animate-[fade-in_var(--duration-ceremony-slow)_var(--ease-ceremony)_both]" : "opacity-0",
        )}
        style={{ animationDelay: "500ms" }}
      >
        scroll to see how ↓
      </p>
    </section>
  );
}

const ACT_II_CHIPS = [
  { label: "who's answering DMs?", pos: "left-[4%] top-[14%] -rotate-2" },
  { label: "taxes… someday", pos: "right-[6%] top-[20%] rotate-3" },
  { label: "weekly update?", pos: "left-[14%] top-[62%] rotate-1" },
  { label: "post something", pos: "right-[10%] bottom-[24%] -rotate-1" },
  { label: "deadline slipping", pos: "left-[30%] bottom-[10%] rotate-2" },
  { label: "receipts, everywhere", pos: "right-[24%] top-[8%] -rotate-3" },
];

function ActII() {
  const [ref, revealed] = useInViewReveal<HTMLDivElement>();
  return (
    <section ref={ref} className="relative mx-auto flex min-h-[85vh] max-w-3xl flex-col items-center justify-center gap-5 overflow-hidden px-6 text-center">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden sm:block">
        {ACT_II_CHIPS.map((chip, i) => (
          <span
            key={chip.label}
            className={cx(
              "absolute rounded-full border border-cta-warm/25 bg-cta-warm/5 px-3 py-1.5 font-mono text-[11px] text-text-muted",
              chip.pos,
              revealed ? "animate-[fade-in_var(--duration-ceremony-slow)_var(--ease-ceremony)_both]" : "opacity-0",
            )}
            style={{ animationDelay: `${i * 90}ms` }}
          >
            {chip.label}
          </span>
        ))}
      </div>
      <ActEyebrow className="text-money/80">Act II · The overwhelm</ActEyebrow>
      <h2
        className={cx(
          "font-display text-3xl font-bold tracking-tight text-balance sm:text-5xl",
          revealed ? "animate-[rise-in_var(--duration-ceremony-base)_var(--ease-ceremony)_both]" : "opacity-0",
        )}
      >
        Who sends the invoices? Who answers the messages? Who posts today?
      </h2>
      <p
        className={cx(
          "text-lg text-text-secondary",
          revealed ? "animate-[fade-in_var(--duration-ceremony-base)_var(--ease-ceremony)_both]" : "opacity-0",
        )}
        style={{ animationDelay: "250ms" }}
      >
        You. All of it. Until now.
      </p>
    </section>
  );
}

const ACT_III_TEAMS: Array<{ tone: BadgeTone; label: string; role: string; initial: string }> = [
  { tone: "money", label: "Money", role: "Keeps the books, chases payment", initial: "$" },
  { tone: "clients", label: "Clients", role: "Answers every message", initial: "C" },
  { tone: "marketing", label: "Marketing", role: "Keeps you posting", initial: "M" },
  { tone: "operations", label: "Operations", role: "Tracks the inventory", initial: "O" },
];

// The hero moment — most weight on purpose (STEP 8): the founder pill and
// connector reuse the exact visual language of the real org-chart reveal
// (OrgChartScreen's founder pill), so the promise made here and the thing
// actually delivered later in the funnel are visibly the same object, not
// two different illustrations of "org chart."
function ActIII() {
  const [ref, revealed] = useInViewReveal<HTMLDivElement>();
  return (
    <section ref={ref} className="mx-auto flex min-h-[95vh] max-w-4xl flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <div className="space-y-2">
        <ActEyebrow className="text-accent/75">Act III · The turn</ActEyebrow>
        <h2
          className={cx(
            "font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl",
            revealed ? "animate-[rise-in_var(--duration-ceremony-base)_var(--ease-ceremony)_both]" : "opacity-0",
          )}
        >
          Every task finds an owner.
        </h2>
        <p className="text-text-secondary">A real org chart, built bottom-up from your idea.</p>
      </div>

      <div
        className={cx(
          "flex flex-col items-center gap-0",
          revealed ? "animate-[fade-in_var(--duration-ceremony-base)_var(--ease-ceremony)_both]" : "opacity-0",
        )}
        style={{ animationDelay: "120ms" }}
      >
        <span className="rounded-lg bg-gradient-to-br from-accent-strong to-cta-warm px-5 py-2.5 font-display text-sm font-semibold text-white shadow-glow-cta">
          You · Founder
        </span>
        <span className="h-8 w-px bg-gradient-to-b from-accent/50 to-transparent" aria-hidden="true" />
      </div>

      <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-4">
        {ACT_III_TEAMS.map((team, i) => (
          <div
            key={team.label}
            className={cx(
              "flex flex-col items-center gap-2 rounded-2xl border border-border bg-bg-glass p-4",
              revealed ? "animate-[rise-in_var(--duration-ceremony-base)_var(--ease-ceremony)_both]" : "opacity-0",
            )}
            style={{ animationDelay: `${i * 110 + 260}ms` }}
          >
            <span
              className={cx(
                "flex size-10 items-center justify-center rounded-full border font-display text-sm font-semibold",
                AVATAR_RING_CLASSES[team.tone],
              )}
              aria-hidden="true"
            >
              {team.initial}
            </span>
            <span className="flex items-center gap-1.5 font-display text-sm font-semibold">
              <span className={cx("size-1.5 rounded-full", DOT_TONE_CLASSES[team.tone])} aria-hidden="true" />
              {team.label}
            </span>
            <span className="text-xs text-text-muted">{team.role}</span>
          </div>
        ))}
      </div>

      <p
        className={cx(
          "font-mono text-xs text-text-muted",
          revealed ? "animate-[fade-in_var(--duration-ceremony-base)_var(--ease-ceremony)_both]" : "opacity-0",
        )}
        style={{ animationDelay: "700ms" }}
      >
        Every teammate named. Every one priced.
      </p>
    </section>
  );
}

const ACT_IV_UPDATES = [
  { action: "Drafted a reply to a customer message", cost: "$0.00" },
  { action: "Logged today's receipts", cost: "$0.00" },
  { action: "Queued tomorrow's post", cost: "$0.00" },
];

function ActIV() {
  const [ref, revealed] = useInViewReveal<HTMLDivElement>();
  return (
    <section ref={ref} className="mx-auto flex min-h-[90vh] max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <ActEyebrow className="text-money/80">Act IV · The company runs</ActEyebrow>
        <h2
          className={cx(
            "font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl",
            revealed ? "animate-[rise-in_var(--duration-ceremony-base)_var(--ease-ceremony)_both]" : "opacity-0",
          )}
        >
          Then it runs itself.
        </h2>
        <p className="text-text-secondary">You just say yes.</p>
      </div>

      <div
        className={cx("w-full", revealed ? "animate-[rise-in_var(--duration-ceremony-base)_var(--ease-ceremony)_both]" : "opacity-0")}
        style={{ animationDelay: "150ms" }}
      >
        <Card className="text-left">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-mono text-xs text-text-muted">
              <span className="size-1.5 rounded-full bg-operations" aria-hidden="true" />
              Your company · live
            </span>
            <span className="font-mono text-xs text-text-muted">
              Today's spend: <span className="text-text">$0.00</span>
            </span>
          </div>
          <ul className="space-y-2.5">
            {ACT_IV_UPDATES.map((item, i) => (
              <li
                key={item.action}
                className={cx(
                  "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-glass-subtle px-3.5 py-2.5 text-sm",
                  revealed ? "animate-[fade-in_var(--duration-ceremony-fast)_var(--ease-ceremony)_both]" : "opacity-0",
                )}
                style={{ animationDelay: `${i * 90 + 300}ms` }}
              >
                <span className="text-text-secondary">{item.action}</span>
                <span className="shrink-0 font-mono text-xs text-text-muted">{item.cost} · awaiting your yes</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

export function LandingStory() {
  return (
    <>
      <ActI />
      <ActII />
      <ActIII />
      <ActIV />
    </>
  );
}
