import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigateMock,
  Link: ({
    to,
    children,
    className,
    onClick,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

vi.mock("../lib/authClient", () => ({
  authClient: { getSession: vi.fn() },
}));

import { authClient } from "../lib/authClient";
import { Index } from "./index";

beforeEach(() => {
  // ScrollSequence reads prefers-reduced-motion in an effect — jsdom
  // doesn't implement matchMedia at all. Stubbing it lets the component
  // mount without throwing; the scroll-scrubbed mechanic itself is inert
  // in jsdom (nothing here triggers a real scroll), which is fine — these
  // tests aren't exercising that part.
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
  navigateMock.mockClear();
  vi.unstubAllGlobals();
  vi.mocked(authClient.getSession).mockReset();
  vi.useRealTimers();
});

// The landing page now has two idea-submission forms (hero + final CTA,
// per the design reference) sharing the exact same placeholder text —
// locating the right one by its distinct button label, then scoping
// queries to that <form>, avoids "multiple elements found" ambiguity.
function getFormByButtonName(name: RegExp) {
  const button = screen.getByRole("button", { name });
  const form = button.closest("form");
  if (!form) throw new Error(`form not found for button matching ${name}`);
  return { form, button, textarea: within(form).getByRole("textbox") };
}

// The bug this covers (issue #61, PR #62/#64): a rejected or hung
// getSession() left the button stuck forever. That fix's behavior is
// unchanged here — only where the idea box sits on the page changed.
describe("Index — hero idea form submission failure", () => {
  it("restores the button, shows a translated error, and preserves the idea on a rejected session check", async () => {
    vi.mocked(authClient.getSession).mockRejectedValueOnce(new Error("Failed to fetch"));

    render(<Index />);
    const { textarea, button } = getFormByButtonName(/meet your company/i);

    fireEvent.change(textarea, { target: { value: "I want to create automatic scheduling application for all social platforms" } });
    fireEvent.click(button);

    expect(await screen.findByText(/one sec/i)).toBeTruthy();

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/couldn't reach the server/i)).toBeTruthy();
    expect(screen.queryByText(/failed to fetch/i)).toBeNull();

    const retry = getFormByButtonName(/meet your company/i);
    expect(retry.button.hasAttribute("disabled")).toBe(false);
    expect((retry.textarea as HTMLTextAreaElement).value).toBe(
      "I want to create automatic scheduling application for all social platforms",
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("also recovers if the session check hangs indefinitely instead of rejecting", async () => {
    vi.useFakeTimers();
    vi.mocked(authClient.getSession).mockReturnValueOnce(new Promise(() => {}));

    render(<Index />);
    const { textarea, button } = getFormByButtonName(/meet your company/i);
    fireEvent.change(textarea, { target: { value: "a hanging idea" } });
    fireEvent.click(button);

    await vi.advanceTimersByTimeAsync(15_000);

    await vi.waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/couldn't reach the server/i)).toBeTruthy();
    expect(getFormByButtonName(/meet your company/i).button.hasAttribute("disabled")).toBe(false);
  });

  it("retrying a successful session check clears the error and navigates to signup", async () => {
    vi.mocked(authClient.getSession)
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce({ data: null } as never);

    render(<Index />);
    const { textarea, button } = getFormByButtonName(/meet your company/i);
    fireEvent.change(textarea, { target: { value: "an idea" } });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(getFormByButtonName(/meet your company/i).button);

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/signup" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Index — final CTA idea form", () => {
  it("submits correctly too — same product logic, different position on the page", async () => {
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: null } as never);

    render(<Index />);
    const { textarea, button } = getFormByButtonName(/build my company/i);
    fireEvent.change(textarea, { target: { value: "final cta idea" } });
    fireEvent.click(button);

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/signup" }));
  });
});

describe("Index — nav and footer", () => {
  it("renders How It Works, Pricing, and Sign In links (not dead, routed to real placeholder pages)", () => {
    vi.mocked(authClient.getSession).mockResolvedValue({ data: null } as never);
    render(<Index />);
    expect(screen.getAllByRole("link", { name: /how it works/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /pricing/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /sign in/i }).length).toBeGreaterThan(0);
  });
});
