import { Link } from "@tanstack/react-router";
import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";

export function ComingSoonPage({ title }: { title: string }) {
  return (
    <>
      <LandingNav />
      <main className="mx-auto flex min-h-[70vh] max-w-[1200px] flex-col items-center justify-center gap-4 px-5 py-24 text-center sm:px-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Coming soon</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-text sm:text-5xl">{title}</h1>
        <p className="max-w-md text-text-secondary">We're still building this page. In the meantime, describe your idea and meet your company.</p>
        <Link
          to="/"
          className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-accent-strong to-cta-warm px-6 py-3 font-display text-[15px] font-semibold text-[#120c22] shadow-glow-cta transition-transform duration-landing-button ease-landing hover:-translate-y-px"
        >
          Back to the idea box →
        </Link>
      </main>
      <LandingFooter />
    </>
  );
}
