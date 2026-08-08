import { forwardRef, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cx } from "../ui";

// Shared building blocks for the landing page's marketing sections
// (docs/design/reference.html) — kept landing-only on purpose. ui.tsx's
// Card/Button stay exactly as they are for every authenticated screen
// (dashboard, org chart, tasks, signup, login); nothing here touches them.

export const SectionContainer = forwardRef<HTMLElement, { children: ReactNode; className?: string }>(
  function SectionContainer({ children, className }, ref) {
    return (
      <section ref={ref} className={cx("mx-auto max-w-[1200px] px-5 py-24 sm:px-8 lg:py-32", className)}>
        {children}
      </section>
    );
  },
);

// Small gradient rounded-square mark before the "Runwisely" wordmark
// (LandingNav, LandingFooter) — same gradient as the primary CTA, not a
// separate brand color.
export function LogoMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-strong to-cta-warm font-display text-sm font-bold text-[#120c22]"
    >
      R
    </span>
  );
}

export function SectionEyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted", className)}>{children}</p>;
}

export function SectionHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cx(
        "font-display text-3xl font-semibold leading-[1.08] tracking-tight text-text sm:text-4xl lg:text-[52px]",
        className,
      )}
    >
      {children}
    </h2>
  );
}

// Flat, non-blurred card — distinct from ui.tsx's Card (the
// backdrop-blur "glass" treatment used by the authenticated app). Matches
// the reference's content-card treatment: no blur, a subtle hover lift,
// on the landing route's own duration/easing (--duration-landing-hover /
// --ease-landing), not the app's calm register.
export function RwCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-[18px] border border-white/[0.08] bg-white/[0.035] p-6 transition-[border-color,background-color,transform] duration-landing-hover ease-landing hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.055]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// Scroll-triggered entrance reveal (the reference's rw-reveal mechanism,
// docs/design/reference-emergent.md) — a section calls this once on its
// own outer ref, then wraps each child that should reveal in <Reveal>,
// staggering delay by 80ms per item to match the reference's own rhythm
// (confirmed via its animation-delay values: 0/80/160ms card stagger,
// 60/140/220/300ms hero stagger). A reduced-motion visitor gets
// everything revealed immediately on mount — never gated behind
// scrolling to a specific point, same principle the deleted (STEP 8)
// useInViewReveal established and this recreates landing-scoped.
export function useRevealOnScroll<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, revealed];
}

// Hero reveals on mount, not on scroll-into-view — it's already in the
// viewport at load, same as the reference's own hero elements (its
// animation-delay values, 60/140/220/300ms, are read directly off its
// stylesheet). Starts false unconditionally so server and client render
// identically before hydration (same principle the deleted STEP 8
// useRevealStage/useInViewReveal hooks already established).
export function useRevealOnMount(): boolean {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => setRevealed(true), []);
  return revealed;
}

export function Reveal({
  revealed,
  delay = 0,
  className,
  children,
}: {
  revealed: boolean;
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("rw-reveal", revealed && "rw-reveal-in", className)} style={revealed ? { animationDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

// Single-open accordion (the reference's "How It Works" steps and
// "Pricing" FAQ both use this exact interaction: click a closed row, it
// expands and the previously-open one collapses). One index lives in the
// parent so both lists can share the same behavior without duplicating
// the open/close state machine.
export function useAccordion(defaultOpenIndex: number | null = null): [number | null, (index: number) => void] {
  const [openIndex, setOpenIndex] = useState(defaultOpenIndex);
  function toggle(index: number) {
    setOpenIndex((current) => (current === index ? null : index));
  }
  return [openIndex, toggle];
}

// Height-animates via a 0fr/1fr grid-template-rows track rather than
// max-height — no arbitrary cap to guess at, and content that grows
// (e.g. longer FAQ answers) never gets clipped. prefers-reduced-motion's
// global transition-duration override (tokens.css) collapses this to an
// instant swap, same as every other landing transition.
export function AccordionItem({
  isOpen,
  onToggle,
  title,
  prefix,
  children,
}: {
  isOpen: boolean;
  onToggle: () => void;
  title: ReactNode;
  prefix?: ReactNode;
  children: ReactNode;
}) {
  const contentId = useId();
  return (
    <div
      className={cx(
        "rounded-[18px] border transition-colors duration-landing-hover ease-landing",
        isOpen ? "border-accent/30 bg-white/[0.045]" : "border-white/[0.08] bg-white/[0.035]",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6 sm:py-5"
      >
        <span className="flex items-center gap-4">
          {prefix}
          <span className="font-display text-base font-semibold text-text sm:text-lg">{title}</span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 8"
          className={cx("size-3 shrink-0 text-text-muted transition-transform duration-landing-hover ease-landing", isOpen && "rotate-180")}
        >
          <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        id={contentId}
        role="region"
        className={cx("grid transition-[grid-template-rows] duration-landing-hover ease-landing", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
