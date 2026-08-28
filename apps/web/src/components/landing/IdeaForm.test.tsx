import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// vi.mock(...) calls below are hoisted above every other top-level
// statement in this file, including plain `const` declarations — a
// factory that references one directly (like summarizeWebsiteMock,
// needed inside an async factory here) would see it uninitialized.
// vi.hoisted() moves the declaration itself above that hoisting point.
const { navigateMock, summarizeWebsiteMock } = vi.hoisted(() => ({ navigateMock: vi.fn(), summarizeWebsiteMock: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../lib/authClient", () => ({
  authClient: { getSession: vi.fn() },
}));

vi.mock("../../lib/extractionClient", async () => {
  const actual = await vi.importActual<typeof import("../../lib/extractionClient")>("../../lib/extractionClient");
  return { ...actual, summarizeWebsite: summarizeWebsiteMock };
});

import { authClient } from "../../lib/authClient";
import { loadIdea } from "../../lib/extractionClient";
import { IdeaForm } from "./IdeaForm";

afterEach(() => {
  cleanup();
  navigateMock.mockClear();
  summarizeWebsiteMock.mockReset();
  vi.mocked(authClient.getSession).mockReset();
  sessionStorage.clear();
});

describe("IdeaForm — website-as-input (ADR-058)", () => {
  it("submits the URL, saves the real summary as the idea, and navigates on success", async () => {
    summarizeWebsiteMock.mockResolvedValueOnce({ status: "completed", summary: "Acme sells handmade candles online." });
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: null } as never);

    render(<IdeaForm buttonLabel="Meet your company" />);
    fireEvent.click(screen.getByRole("button", { name: "Paste your website" }));
    fireEvent.change(screen.getByPlaceholderText("https://yourbusiness.com"), { target: { value: "https://acme.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Read my site" }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/signup" }));
    expect(summarizeWebsiteMock).toHaveBeenCalledWith("https://acme.example");
    expect(loadIdea()).toBe("Acme sells handmade candles online.");
  });

  it("falls back to the text box with an inline message on insufficient content — never a dead end", async () => {
    summarizeWebsiteMock.mockResolvedValueOnce({ status: "insufficient-content" });

    render(<IdeaForm buttonLabel="Meet your company" />);
    fireEvent.click(screen.getByRole("button", { name: "Paste your website" }));
    fireEvent.change(screen.getByPlaceholderText("https://yourbusiness.com"), { target: { value: "https://thin.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Read my site" }));

    await waitFor(() => expect(screen.getByText(/describe your business instead/i)).toBeTruthy());
    // Back on the text tab, ready to type immediately — not stuck.
    expect(screen.getByPlaceholderText(/handmade candles/i)).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("falls back the same way on an unsafe URL", async () => {
    summarizeWebsiteMock.mockResolvedValueOnce({ status: "unsafe-url", error: "private address" });

    render(<IdeaForm buttonLabel="Meet your company" />);
    fireEvent.click(screen.getByRole("button", { name: "Paste your website" }));
    fireEvent.change(screen.getByPlaceholderText("https://yourbusiness.com"), { target: { value: "http://169.254.169.254" } });
    fireEvent.click(screen.getByRole("button", { name: "Read my site" }));

    await waitFor(() => expect(screen.getByText(/describe your business instead/i)).toBeTruthy());
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("text mode is unaffected by any of this — types and submits exactly as before", async () => {
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: null } as never);

    render(<IdeaForm buttonLabel="Meet your company" />);
    fireEvent.change(screen.getByPlaceholderText(/handmade candles/i), { target: { value: "I run a bakery" } });
    fireEvent.click(screen.getByRole("button", { name: "Meet your company" }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/signup" }));
    expect(summarizeWebsiteMock).not.toHaveBeenCalled();
    expect(loadIdea()).toBe("I run a bakery");
  });
});
