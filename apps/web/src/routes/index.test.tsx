import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigateMock,
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

// LandingStory (Acts I-IV) is unrelated pre-signup marketing content that
// depends on IntersectionObserver, which jsdom doesn't implement — mocking
// it out keeps this test scoped to the actual bug (the idea-box submit
// handler, Act V) without dragging in an unrelated dependency.
vi.mock("../components/LandingStory", () => ({
  LandingStory: () => null,
}));

vi.mock("../lib/authClient", () => ({
  authClient: { getSession: vi.fn() },
}));

import { authClient } from "../lib/authClient";
import { Index } from "./index";

afterEach(() => {
  cleanup();
  navigateMock.mockClear();
  vi.mocked(authClient.getSession).mockReset();
  vi.useRealTimers();
});

// The bug this covers: handleSubmit's getSession() -> navigate() chain had
// no error handling at all — the same missing-.catch() pattern issue #45
// found on the interview screen, one screen earlier this time. A rejected
// (or hung) getSession() left setSubmitting(true) as the last state update
// that ever ran: the "One sec…" button stuck forever, no error, no retry,
// no way out, and the request was silently misdirected to a stale
// localhost:3000 bundle so this fired on every real visitor.
describe("Index — idea submission failure", () => {
  it("restores the button, shows a translated error, and preserves the idea on a rejected session check", async () => {
    vi.mocked(authClient.getSession).mockRejectedValueOnce(new Error("Failed to fetch"));

    render(<Index />);

    const textarea = screen.getByPlaceholderText(/handmade candles/i);
    fireEvent.change(textarea, { target: { value: "I want to create automatic scheduling application for all social platforms" } });

    const submitButton = screen.getByRole("button", { name: /meet your company/i });
    fireEvent.click(submitButton);

    expect(await screen.findByText(/one sec/i)).toBeTruthy();

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/couldn't reach the server/i)).toBeTruthy();

    // Never the raw fetch/SDK error text — the component must translate it.
    expect(screen.queryByText(/failed to fetch/i)).toBeNull();

    const retryButton = screen.getByRole("button", { name: /meet your company/i });
    expect(retryButton.hasAttribute("disabled")).toBe(false);

    expect((textarea as HTMLTextAreaElement).value).toBe(
      "I want to create automatic scheduling application for all social platforms",
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("also recovers if the session check hangs indefinitely instead of rejecting", async () => {
    vi.useFakeTimers();
    vi.mocked(authClient.getSession).mockReturnValueOnce(new Promise(() => {}));

    render(<Index />);

    const textarea = screen.getByPlaceholderText(/handmade candles/i);
    fireEvent.change(textarea, { target: { value: "a hanging idea" } });
    fireEvent.click(screen.getByRole("button", { name: /meet your company/i }));

    await vi.advanceTimersByTimeAsync(15_000);

    await vi.waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/couldn't reach the server/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /meet your company/i }).hasAttribute("disabled")).toBe(false);
  });

  it("retrying a successful session check clears the error and navigates to signup", async () => {
    vi.mocked(authClient.getSession)
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      // biome-ignore lint: matches authClient.getSession's real Better Auth return shape closely enough for this test
      .mockResolvedValueOnce({ data: null } as never);

    render(<Index />);

    const textarea = screen.getByPlaceholderText(/handmade candles/i);
    fireEvent.change(textarea, { target: { value: "an idea" } });
    fireEvent.click(screen.getByRole("button", { name: /meet your company/i }));

    const retryButton = await waitFor(() => screen.getByRole("button", { name: /meet your company/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(retryButton);

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/signup" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
