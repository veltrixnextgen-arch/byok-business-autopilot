import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { DataDeletionPage } from "./DataDeletionPage";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Meta App Review's own hard requirement (meta-app-review-checklist.md):
// "a valid Data Deletion Callback URL or Data Deletion Instructions URL —
// absence causes automatic rejection." This asserts the page actually
// contains what a reviewer checks for, not just that the route exists.
describe("DataDeletionPage", () => {
  it("explains how to revoke access directly from Meta (Facebook/Instagram)", () => {
    render(<DataDeletionPage />);
    expect(screen.getByText(/revoke access from meta directly/i)).toBeTruthy();
    expect(screen.getByText(/Apps and Websites/)).toBeTruthy();
  });

  it("gives a concrete full-deletion path with an email address and a stated turnaround", () => {
    render(<DataDeletionPage />);
    const emailMatches = screen.getAllByText(/privacy@runwisely\.com/);
    expect(emailMatches.length).toBeGreaterThan(0);
    expect(screen.getByText(/within 30 days/i)).toBeTruthy();
  });

  it("explains the faster in-app revoke path, not just the email path", () => {
    render(<DataDeletionPage />);
    expect(screen.getByText(/revoke access at the source/i)).toBeTruthy();
  });

  it("links back to the full privacy policy", () => {
    render(<DataDeletionPage />);
    // Two legitimate matches — this page's own body link, plus
    // LandingFooter's — asserting at least one resolves correctly.
    const links = screen.getAllByRole("link", { name: "Privacy Policy" });
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => link.getAttribute("href") === "/privacy")).toBe(true);
  });
});
