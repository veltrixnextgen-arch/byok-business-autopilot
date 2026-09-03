import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { TermsOfServicePage } from "./TermsOfServicePage";

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

// Regression coverage for the specific, real claims this page makes —
// a future copy edit shouldn't silently drop the BYOK disclaimer, the
// real prices, or the draft-only/human-approval property without a
// test catching it.
describe("TermsOfServicePage", () => {
  it("states BYOK plainly: the provider bills the user directly, never marked up", () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/billed to you directly by that provider/i)).toBeTruthy();
    expect(screen.getByText(/never marked up, never billed through us/i)).toBeTruthy();
  });

  it("names the real, current prices — not placeholder numbers", () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/\$39\.99/)).toBeTruthy();
    expect(screen.getByText(/\$107\.97/)).toBeTruthy();
    expect(screen.getByText(/\$383\.90/)).toBeTruthy();
  });

  it("states the draft-only default and names the one real exception honestly, not as a blanket promise", () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/nothing is sent, posted, paid, or executed until a human reviews it/i)).toBeTruthy();
    expect(screen.getByText(/exactly one narrow exception/i)).toBeTruthy();
    expect(screen.getByText(/every other task type, for every business, stays draft-only/i)).toBeTruthy();
  });

  it("states one company per account, matching the real pricing plan", () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/your subscription covers one active company/i)).toBeTruthy();
  });

  it("links to the privacy policy rather than duplicating it", () => {
    render(<TermsOfServicePage />);
    // LandingFooter also links to /privacy — asserting at least one
    // match (the body's own cross-link) is the point, not exactly one.
    const links = screen.getAllByRole("link", { name: /privacy policy/i });
    expect(links.some((link) => link.getAttribute("href") === "/privacy")).toBe(true);
  });

  it("gives a real contact address", () => {
    render(<TermsOfServicePage />);
    const link = screen.getByRole("link", { name: "veltrixnextgen@gmail.com" });
    expect(link.getAttribute("href")).toBe("mailto:veltrixnextgen@gmail.com");
  });
});
