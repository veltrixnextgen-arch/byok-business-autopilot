import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../lib/extractionClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/extractionClient")>();
  return {
    ...actual,
    loadIdea: () => "a mobile dog grooming business",
    recordFunnelEvent: vi.fn(),
    fetchQuestions: vi.fn(),
    startBatch: vi.fn(),
  };
});

import { ApiError, fetchQuestions } from "../lib/extractionClient";
import { InterviewScreen } from "./InterviewScreen";

afterEach(() => {
  cleanup();
  navigateMock.mockClear();
  vi.mocked(fetchQuestions).mockReset();
});

// The bug this covers: the initial fetchQuestions() call in the mount
// effect had no .catch() at all — a rejected promise left the screen on
// "Reading your idea…" forever, with no error, no retry, no skip. Every
// assertion here is checking a specific piece of the fix, not just "it
// doesn't crash."
describe("InterviewScreen — initial load failure", () => {
  it("lands on the error phase with both retry and skip reachable on a network failure", async () => {
    vi.mocked(fetchQuestions).mockRejectedValueOnce(new Error("fetch failed"));

    render(<InterviewScreen />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/something went wrong loading your questions/i)).toBeTruthy();

    const retryButton = screen.getByRole("button", { name: /try again/i });
    const skipButton = screen.getByRole("button", { name: /skip the rest/i });
    expect(retryButton).toBeTruthy();
    expect(skipButton).toBeTruthy();
    expect(retryButton.hasAttribute("disabled")).toBe(false);
    expect(skipButton.hasAttribute("disabled")).toBe(false);

    // Never the raw error text — the component must translate it, not echo it.
    expect(screen.queryByText(/fetch failed/i)).toBeNull();
  });

  it("offers sign-in instead of retry on a 401, and still keeps skip reachable", async () => {
    vi.mocked(fetchQuestions).mockRejectedValueOnce(new ApiError(401, "Could not load interview questions (401)."));

    render(<InterviewScreen />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/session expired/i)).toBeTruthy();

    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /skip the rest/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^try again$/i })).toBeNull();

    // Never raw HTTP/SDK text on screen, even for the 401 case.
    expect(screen.queryByText(/\(401\)/)).toBeNull();
  });

  it("retrying a successful reload clears the error and renders the first question", async () => {
    vi.mocked(fetchQuestions)
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({
        questions: [{ id: "whatCustomersPayFor", kind: "text", prompt: "What do customers pay you for?" }],
        templateHint: null,
        guess: {},
      });

    render(<InterviewScreen />);

    const retryButton = await waitFor(() => screen.getByRole("button", { name: /try again/i }));
    fireEvent.click(retryButton);

    await waitFor(() => expect(screen.getByText("What do customers pay you for?")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
