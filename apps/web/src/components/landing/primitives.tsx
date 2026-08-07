import type { ReactNode } from "react";
import { cx } from "../ui";

// Shared building blocks for the landing page's marketing sections
// (docs/design/reference.html) — kept landing-only on purpose. ui.tsx's
// Card/Button stay exactly as they are for every authenticated screen
// (dashboard, org chart, tasks, signup, login); nothing here touches them.

export function SectionContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("mx-auto max-w-[1200px] px-5 py-24 sm:px-8 lg:py-32", className)}>{children}</section>;
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
// the reference's content-card treatment: no blur, a subtle hover lift.
export function RwCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-[18px] border border-white/[0.08] bg-white/[0.035] p-6 transition-[border-color,background-color,transform] duration-calm-base ease-calm hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.055]",
        className,
      )}
    >
      {children}
    </div>
  );
}
