import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { ComingSoonPage } from "./ComingSoonPage";

afterEach(() => cleanup());

// The nav promises "How It Works" and "Pricing" — this is what makes
// that not a lie: a real page, not a 404, with a way back to the idea box.
describe("ComingSoonPage", () => {
  it("renders the given title and a link back to the landing page", () => {
    render(<ComingSoonPage title="Pricing" />);
    expect(screen.getByRole("heading", { name: "Pricing" })).toBeTruthy();
    const backLink = screen.getByRole("link", { name: /back to the idea box/i });
    expect(backLink.getAttribute("href")).toBe("/");
  });
});
