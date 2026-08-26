import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

import { PricingPage } from "./PricingPage";

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

describe("PricingPage — real prices (ADR-044)", () => {
  it("shows the real monthly prices by default, not a placeholder", () => {
    render(<PricingPage />);
    expect(screen.getByText("$39")).toBeTruthy();
    expect(screen.getByText("$89")).toBeTruthy();
    expect(screen.getByText("$249")).toBeTruthy();
    expect(screen.queryByText("Pricing not finalised. Values shown are placeholders.")).toBeNull();
  });

  it("switches to the real annual prices (2 months free) when the toggle is clicked", () => {
    render(<PricingPage />);
    fireEvent.click(screen.getByRole("button", { name: "Annual — 2 months free" }));

    expect(screen.getByText("$390")).toBeTruthy();
    expect(screen.getByText("$890")).toBeTruthy();
    expect(screen.getByText("$2,490")).toBeTruthy();
    expect(screen.queryByText("$39")).toBeNull();
  });

  it("leads with no credit caps and is honest that scheduled work is draft-only", () => {
    render(<PricingPage />);
    expect(screen.getByText("No credit caps")).toBeTruthy();
    expect(screen.getByText("Drafts, not actions")).toBeTruthy();
    expect(screen.getByText(/Are there usage credits, or a cap I can run out of\?/)).toBeTruthy();
    expect(screen.getByText(/Does Runwisely act automatically, or do I review its work\?/)).toBeTruthy();
  });
});
