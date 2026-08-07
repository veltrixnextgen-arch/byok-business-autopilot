import { Link } from "@tanstack/react-router";

export function LandingFooter() {
  return (
    <footer className="border-t border-border-subtle">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-6 px-5 py-12 text-center sm:flex-row sm:justify-between sm:px-8 sm:text-left">
        <span className="font-display text-[17px] font-semibold tracking-tight text-text">Runwisely</span>
        <nav className="flex flex-wrap items-center justify-center gap-6">
          <Link to="/how-it-works" className="font-body text-sm text-text-secondary transition-colors duration-landing-hover ease-landing hover:text-text">
            How It Works
          </Link>
          <Link to="/pricing" className="font-body text-sm text-text-secondary transition-colors duration-landing-hover ease-landing hover:text-text">
            Pricing
          </Link>
          <Link to="/login" className="font-body text-sm text-text-secondary transition-colors duration-landing-hover ease-landing hover:text-text">
            Sign In
          </Link>
        </nav>
        <p className="font-mono text-xs text-text-muted">© 2026 Runwisely</p>
      </div>
    </footer>
  );
}
