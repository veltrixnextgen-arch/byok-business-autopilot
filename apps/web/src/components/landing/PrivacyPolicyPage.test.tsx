import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { PrivacyPolicyPage } from "./PrivacyPolicyPage";

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

// Regression coverage for the two review checklists this page exists to
// satisfy (docs/design/google-oauth-verification-checklist.md,
// meta-app-review-checklist.md) — a future copy edit that accidentally
// drops one of these specific, reviewer-checked claims should fail a
// test, not just slip into a rejected submission.
describe("PrivacyPolicyPage", () => {
  it("names every data category actually collected", () => {
    render(<PrivacyPolicyPage />);
    expect(screen.getByText(/business idea and interview answers/i)).toBeTruthy();
    // "Account information" and "AI provider keys" are each named twice
    // (the bullet label, and again in a later section's prose) —
    // asserting at least one match is the point, not exactly one.
    expect(screen.getAllByText(/account information/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ai provider keys/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/connected-service credentials \(hands keys\), including oauth tokens/i)).toBeTruthy();
  });

  it("names the exact Google Calendar scope and what it's used for — reviewers cross-check this specifically", () => {
    render(<PrivacyPolicyPage />);
    expect(screen.getByText(/https:\/\/www\.googleapis\.com\/auth\/calendar\.events/)).toBeTruthy();
    expect(screen.getByText(/scheduling and event coordinator agents/i)).toBeTruthy();
  });

  it("gives a concrete deletion path with an email address, not just a vague promise", () => {
    render(<PrivacyPolicyPage />);
    const emailLinks = screen.getAllByRole("link", { name: "privacy@runwisely.com" });
    expect(emailLinks.length).toBeGreaterThan(0);
    expect(emailLinks[0]?.getAttribute("href")).toBe("mailto:privacy@runwisely.com");
    expect(screen.getByText(/within 30 days/i)).toBeTruthy();
  });

  it("links to the data-deletion page for the Meta-specific path", () => {
    render(<PrivacyPolicyPage />);
    const link = screen.getByRole("link", { name: /data deletion instructions/i });
    expect(link.getAttribute("href")).toBe("/data-deletion");
  });
});
