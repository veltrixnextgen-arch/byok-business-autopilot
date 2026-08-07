import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollSequence } from "./ScrollSequence";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Hard constraint: prefers-reduced-motion must get a static fallback, not
// just a slower version of the scroll-scrubbed mechanic — scroll-jacking
// itself is the thing reduced-motion visitors want turned off.
describe("ScrollSequence", () => {
  it("renders all six steps as a static stacked list when prefers-reduced-motion is set", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

    render(<ScrollSequence />);

    expect(screen.getByText("You have the idea.")).toBeTruthy();
    expect(screen.getByText("Your company exists.")).toBeTruthy();
    // All six headings present at once — a stacked list, not one pinned step.
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBe(6);
  });

  it("renders only the pinned sticky viewport (one active step) when motion is not reduced", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

    render(<ScrollSequence />);

    expect(screen.getByText("You have the idea.")).toBeTruthy();
    expect(screen.queryByText("Your company exists.")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBe(1);
  });

  // The reference shows a 6-segment progress bar with a cumulative
  // gradient fill (segments up to and including the active step are
  // filled) — a gap the earlier computed-style-only pass missed
  // entirely, since it only shows up as real CSS/DOM, not a static
  // snapshot of colors and fonts.
  it("shows a six-segment progress indicator, only the first segment filled at step 1", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

    const { container } = render(<ScrollSequence />);
    const segments = [...container.querySelectorAll("span.h-1.w-8")];

    expect(segments.length).toBe(6);
    expect(segments[0].className).toContain("from-accent-strong");
    expect(segments[1].className).not.toContain("from-accent-strong");
  });
});
