import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LogoMark } from "./primitives";

const NAV_LINKS = [
  { to: "/how-it-works", label: "How It Works" },
  { to: "/pricing", label: "Pricing" },
] as const;

// "How It Works" and "Pricing" route to plain coming-soon pages
// (ComingSoonPage), not dead links — a nav that promises pages and 404s
// is worse than no nav. Building those pages out for real is separate
// post-pilot work; this just keeps the nav honest in the meantime.
export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-[rgba(10,13,22,0.72)] backdrop-blur-md">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-5 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5 font-display text-[17px] font-semibold tracking-tight text-text">
          <LogoMark />
          Runwisely
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="font-body text-sm text-text-secondary transition-colors duration-landing-hover ease-landing hover:text-text"
            >
              {link.label}
            </Link>
          ))}
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-full border border-border bg-bg-glass px-5 py-2 font-display text-sm font-medium text-text transition-colors duration-landing-hover ease-landing hover:border-border-strong hover:bg-white/[0.08]"
          >
            Sign In
          </Link>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="flex size-9 items-center justify-center rounded-full border border-border text-text md:hidden"
        >
          <span aria-hidden="true">{open ? "✕" : "☰"}</span>
        </button>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-border-subtle px-5 py-4 md:hidden">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 font-body text-sm text-text-secondary hover:bg-bg-glass hover:text-text"
            >
              {link.label}
            </Link>
          ))}
          <Link
            to="/login"
            onClick={() => setOpen(false)}
            className="mt-1 rounded-lg px-3 py-2.5 font-body text-sm font-medium text-text hover:bg-bg-glass"
          >
            Sign In
          </Link>
        </nav>
      )}
    </header>
  );
}
