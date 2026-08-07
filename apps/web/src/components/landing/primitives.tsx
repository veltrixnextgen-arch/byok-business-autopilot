import { forwardRef, type ReactNode, useEffect, useRef, useState } from "react";
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
