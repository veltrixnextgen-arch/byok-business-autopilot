import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("../lib/authClient", () => ({
  authClient: {
    organization: { create: vi.fn(), setActive: vi.fn() },
  },
  signUp: { email: vi.fn() },
}));

import { authClient, signUp } from "../lib/authClient";
import { loadIdea, saveIdea } from "../lib/extractionClient";
import { OnboardingScreen } from "./OnboardingScreen";
import { SignupScreen } from "./SignupScreen";

function fillAndSubmitSignup() {
  fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Jane" } });
  fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "jane@example.com" } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: /^sign up$/i }));
}

function fillAndSubmitOnboarding() {
  fireEvent.change(screen.getByPlaceholderText(/acme studio/i), { target: { value: "Acme Studio" } });
  fireEvent.click(screen.getByRole("button", { name: /create company/i }));
}

afterEach(() => {
  cleanup();
  navigateMock.mockClear();
  sessionStorage.clear();
  vi.mocked(signUp.email).mockReset();
  vi.mocked(authClient.organization.create).mockReset();
  vi.mocked(authClient.organization.setActive).mockReset();
});

// The bug this covers: a signed-out visitor's idea (saved to sessionStorage
// by the idea box, routes/index.tsx) has to survive signup AND org creation
// to actually reach the interview. Reported failure: submit idea -> signup
// -> org creation ("what's your company name") -> landed on /dashboard
// (still the Step 1 placeholder), idea never reaching the interview. Root
// cause: OnboardingScreen's post-create navigation was unconditionally
// "/dashboard", regardless of whether a pending idea existed.
describe("idea hand-off: signup -> org creation -> interview", () => {
  it("carries a pending idea through signup and org creation to /interview", async () => {
    const idea = "I want to create automatic scheduling application for all social platforms";
    saveIdea(idea);

    vi.mocked(signUp.email).mockResolvedValueOnce({ error: null } as never);
    const signupRender = render(<SignupScreen />);
    fillAndSubmitSignup();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/interview" }));
    expect(loadIdea()).toBe(idea);
    signupRender.unmount();

    // Org creation, reached independently (e.g. dashboard's beforeLoad
    // sends a no-org user here) — the idea must still be honored here too.
    navigateMock.mockClear();
    vi.mocked(authClient.organization.create).mockResolvedValueOnce({ data: { id: "org_1" }, error: null } as never);
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({ error: null } as never);
    render(<OnboardingScreen />);
    fillAndSubmitOnboarding();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/interview" }));
    expect(loadIdea()).toBe(idea);
  });

  it("falls back to /dashboard at signup and to /charter at org creation when there is no pending idea", async () => {
    vi.mocked(signUp.email).mockResolvedValueOnce({ error: null } as never);
    render(<SignupScreen />);
    fillAndSubmitSignup();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/dashboard" }));

    navigateMock.mockClear();
    vi.mocked(authClient.organization.create).mockResolvedValueOnce({ data: { id: "org_1" }, error: null } as never);
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({ error: null } as never);
    render(<OnboardingScreen />);
    fillAndSubmitOnboarding();
    // R2/ADR-024: org creation now routes through the Charter review/handoff
    // ceremony before the dashboard, not straight to it.
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/charter" }));
  });
});
