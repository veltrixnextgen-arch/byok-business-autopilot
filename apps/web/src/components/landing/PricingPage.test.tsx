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

describe("PricingPage — one plan, three billing periods (ADR-057)", () => {
  it("shows the real monthly price by default, not a placeholder", () => {
    render(<PricingPage />);
    expect(screen.getByText("$39.99")).toBeTruthy();
    expect(screen.queryByText("Pricing not finalised. Values shown are placeholders.")).toBeNull();
  });

  it("switches to the quarterly effective monthly rate with the real billed total shown small beneath", () => {
    render(<PricingPage />);
    fireEvent.click(screen.getByRole("button", { name: "Quarterly — save 10%" }));

    // The big number is the effective monthly rate, derived from the real
    // billed total — never a lump "$/quarter" figure.
    expect(screen.getByText("$35.99")).toBeTruthy();
    expect(screen.queryByText("$39.99")).toBeNull();
    expect(screen.getByText(/\$107\.97 billed quarterly · save 10%/)).toBeTruthy();
  });

  it("switches to the yearly effective monthly rate with the real billed total shown small beneath", () => {
    render(<PricingPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yearly — save 20%" }));

    expect(screen.getByText("$31.99")).toBeTruthy();
    expect(screen.queryByText("$39.99")).toBeNull();
    expect(screen.getByText(/\$383\.90 billed yearly · save 20%/)).toBeTruthy();
  });

  it("leads with no credit caps and is honest that scheduled work is draft-only", () => {
    render(<PricingPage />);
    expect(screen.getByText("No credit caps")).toBeTruthy();
    expect(screen.getByText("Drafts, not actions")).toBeTruthy();
    expect(screen.getByText(/Are there usage credits, or a cap I can run out of\?/)).toBeTruthy();
    expect(screen.getByText(/Does Runwisely act automatically, or do I review its work\?/)).toBeTruthy();
  });
});
