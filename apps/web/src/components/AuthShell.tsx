import { Link } from "@tanstack/react-router";
import type { InputHTMLAttributes, ReactNode } from "react";
import { LogoMark } from "./landing/primitives";
import { NetworkIllustration } from "./landing/NetworkIllustration";
import { cx } from "./ui";

// Split-screen shell shared by /login and /signup, matching the Emergent
// reference's own sign-in screen (docs/design/reference-emergent.md /
// ADR-018's third addendum — the reference is authoritative per-screen,
// not just for landing): a logo-only header (no nav links, no "Sign In"
// button — redundant on the page that already is one), eyebrow + headline
// + subtitle + form on the left, the same NetworkIllustration used on the
// landing hero on the right. Product logic (auth calls, navigation, error
// handling) lives entirely in each screen's own component; this only
// supplies the shell and the reference-measured field/button treatment.
//
// Motion stays on the app's calm register (duration-calm-fast/ease-calm),
// not the landing-only tokens — ADR-018's second addendum already decided
// login/signup keep ceremony/calm, unchanged here. Only the static shape
// (pill button, 12px-radius inputs, colors) is taken from the reference's
// measured values; transitions follow existing app convention.
export function AuthShell({
  eyebrow,
  headline,
  subtitle,
  children,
}: {
  eyebrow: string;
  headline: ReactNode;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="px-5 py-6 sm:px-8">
        <Link to="/" className="inline-flex items-center gap-2.5 font-display text-[17px] font-semibold tracking-tight text-text">
          <LogoMark />
          Runwisely
        </Link>
      </header>
      <div className="mx-auto grid w-full max-w-[1200px] flex-1 items-center gap-12 px-5 pb-16 sm:px-8 lg:grid-cols-2 lg:gap-16">
        <div className="mx-auto w-full max-w-md">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">{eyebrow}</p>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-text sm:text-5xl">{headline}</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
        <NetworkIllustration stage={2} />
      </div>
    </div>
  );
}

// Label + input styled to the reference's measured sign-in field (11px
// uppercase tracked label, 12px-radius input, 3%-white background,
// 8%-white border) — kept local to auth screens rather than changed on
// ui.tsx's shared Field/TextInput, which every other screen (tasks,
// interview, styleguide, …) also uses and this PR doesn't touch.
export function AuthField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-2 text-left">
      <label htmlFor={htmlFor} className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

export function AuthInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 font-body text-text placeholder:text-text-muted transition-colors duration-calm-fast ease-calm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20",
        className,
      )}
      {...props}
    />
  );
}

// The reference's Continue button: full pill, the same accent-strong ->
// cta-warm gradient as everywhere else in the product, dark text. Matches
// IdeaForm.tsx's button shape exactly (measured 999px radius, same
// gradient) — duplicated locally rather than shared, since IdeaForm's
// button also carries idea-specific disabled/label logic that doesn't
// belong here.
export function AuthSubmitButton({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        "inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-br from-accent-strong to-cta-warm px-6 py-3 font-display text-[15px] font-semibold text-[#120c22] shadow-glow-cta transition-transform duration-calm-fast ease-calm hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
