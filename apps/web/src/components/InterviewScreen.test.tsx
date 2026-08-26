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

import { ApiError, fetchQuestions, startBatch } from "../lib/extractionClient";
import { InterviewScreen } from "./InterviewScreen";

afterEach(() => {
  cleanup();
  navigateMock.mockClear();
  vi.mocked(fetchQuestions).mockReset();
  vi.mocked(startBatch).mockReset();
  vi.unstubAllGlobals();
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

// startBatch is deliberately left pending (never resolved) — every test
// below is checking what the screen looks like *while genuinely waiting*
// on the real call, not what happens after it resolves (that path — the
// screen unmounting on navigate-away — is exercised by the existing
// submit-success/submit-failure behavior elsewhere, unchanged by this
// work).
async function reachSubmittingPhase() {
  const oneQuestion = { questions: [{ id: "whatCustomersPayFor" as const, kind: "text" as const, prompt: "What do customers pay you for?" }], templateHint: null, guess: {} };
  vi.mocked(fetchQuestions)
    .mockResolvedValueOnce(oneQuestion) // initial load
    // refetchQuestions() runs again after that answer — the same
    // single-question list comes back unchanged (no new branch question
    // appeared), which is what index >= questions.length uses to notice
    // the interview is over and triggers submit().
    .mockResolvedValueOnce(oneQuestion);
  vi.mocked(startBatch).mockImplementationOnce(() => new Promise(() => {}));

  render(<InterviewScreen />);
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Grooming appointments" } });
  // The Continue button's disabled state is driven by TextQuestion's own
  // local state update from that change event — waiting for it to
  // actually reflect (rather than assuming the click follows
  // synchronously) is what makes this robust under CI's slower/differently
  // scheduled environment, where a same-tick assumption was observed to
  // flake even though it never did locally.
  const continueButton = await screen.findByRole("button", { name: /continue/i });
  // TextQuestion's disabled state is a synchronous `!local.trim()` derived
  // straight from onChange's setState — there's no debounce or async gap
  // to wait out. The default 1000ms waitFor timeout is enough on a quiet
  // machine but flaked on CI's shared runner (21 other test files, full
  // monorepo suite in one job) even with the retry this waitFor already
  // adds — a longer timeout tolerates that contention without weakening
  // what's actually being asserted.
  await waitFor(() => expect(continueButton.hasAttribute("disabled")).toBe(false), { timeout: 5000 });
  fireEvent.click(continueButton);

  await waitFor(() => expect(screen.getByText("Building your company…")).toBeTruthy());
}

// The Building-your-company screen (STEP 7 design fidelity pass, Phase 1D)
// wraps startBatch — a single opaque network call with no real
// incremental progress signal. These tests check the honesty property
// that matters most: the checklist's last step must never render a
// checkmark while the real call is still pending, no matter how long the
// (timer-driven, approximate) animation runs.
function stubReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

describe("InterviewScreen — generating state", () => {
  it("shows the checklist with the first step active as soon as submission starts", async () => {
    stubReducedMotion(false);
    await reachSubmittingPhase();

    expect(screen.getByText("Understanding your business")).toBeTruthy();
    expect(screen.getByText("Discovering the work")).toBeTruthy();
    expect(screen.getByText("Forming your teams")).toBeTruthy();
    expect(screen.getByText("Assigning your agents")).toBeTruthy();
    expect(screen.queryAllByText("✓").length).toBe(0);
  });

  it(
    "never marks the last checklist step done while startBatch is still pending, no matter how long the timer runs",
    async () => {
      stubReducedMotion(false);
      await reachSubmittingPhase();

      // Real time, deliberately past enough of it for every step's
      // animation to have run its course — the real call is still
      // unresolved. Three steps ("done") get a checkmark; the fourth
      // stays "active" (a pulsing dot) forever, because only the real
      // call resolving — which unmounts this screen — is allowed to end
      // it.
      await waitFor(() => expect(screen.queryAllByText("✓").length).toBe(3), { timeout: 10_000 });
      expect(screen.getByText("Assigning your agents")).toBeTruthy();
    },
    15_000,
  );

  it("respects prefers-reduced-motion by skipping straight to the final still-working state, not a ticking animation", async () => {
    stubReducedMotion(true);
    await reachSubmittingPhase();

    await waitFor(() => expect(screen.queryAllByText("✓").length).toBe(3));
    expect(screen.getByText("Assigning your agents")).toBeTruthy();
  });
});
