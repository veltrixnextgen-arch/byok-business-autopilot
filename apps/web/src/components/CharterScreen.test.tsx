import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const getCharterState = vi.fn();
const createDraft = vi.fn();
const updateDraft = vi.fn();
const acceptDraft = vi.fn();
vi.mock("../lib/charterClient", () => ({
  getCharterState: () => getCharterState(),
  createDraft: () => createDraft(),
  updateDraft: (id: string, content: unknown) => updateDraft(id, content),
  acceptDraft: (id: string) => acceptDraft(id),
}));

const getOrgChartForTenant = vi.fn();
const loadIdea = vi.fn();
vi.mock("../lib/extractionClient", () => ({
  getOrgChartForTenant: () => getOrgChartForTenant(),
  loadIdea: () => loadIdea(),
}));

import { CharterScreen } from "./CharterScreen";

const DRAFT = {
  id: "draft-1",
  status: "draft" as const,
  version: 1,
  content: {
    sharpenedIdea: "A better idea",
    mvpDefinition: "The MVP",
    roleMandates: [],
    monthOneGoals: ["Goal one"],
    budgetCeilingUsd: 500,
  },
  createdAt: "2026-08-20T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CharterScreen — handoff ceremony", () => {
  it("shows what was scheduled, with clamp notes, instead of navigating away silently", async () => {
    getCharterState.mockResolvedValue({ active: null, draft: DRAFT, rawDraft: null });
    getOrgChartForTenant.mockResolvedValue(null);
    updateDraft.mockResolvedValue(DRAFT);
    acceptDraft.mockResolvedValue({
      charter: { ...DRAFT, status: "active" },
      sync: { added: ["t1:agent:task1", "t1:agent:task2"], removed: [], unchanged: [], clampNotes: [{ taskId: "task2", reason: "Clamped to solo tier's daily floor." }] },
    });

    render(<CharterScreen />);

    const acceptButton = await screen.findByRole("button", { name: /Hand the Charter/ });
    fireEvent.click(acceptButton);

    await screen.findByText("Charter handed off");
    expect(screen.getByText("2 tasks scheduled to run on cadence.")).toBeTruthy();
    expect(screen.getByText(/Clamped to solo tier's daily floor\./)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Continue to dashboard" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/dashboard" });
  });

  it("shows the honest fallback when nothing was scheduled", async () => {
    getCharterState.mockResolvedValue({ active: null, draft: DRAFT, rawDraft: null });
    getOrgChartForTenant.mockResolvedValue(null);
    updateDraft.mockResolvedValue(DRAFT);
    acceptDraft.mockResolvedValue({ charter: { ...DRAFT, status: "active" }, sync: null });

    render(<CharterScreen />);

    const acceptButton = await screen.findByRole("button", { name: /Hand the Charter/ });
    fireEvent.click(acceptButton);

    await waitFor(() => expect(screen.getByText("Nothing was scheduled yet — claim an org chart first.")).toBeTruthy());
  });

  // Previously a dead end (2026-09-04): this state had no way back into
  // the interview at all. Fixed honestly rather than implying a
  // capability that doesn't exist (there is no "edit this company's
  // existing answers in place" feature) — the copy and link branch on
  // whether a real interview is genuinely still pending, since
  // /interview otherwise silently bounces to "/" and starting fresh
  // from there creates a brand new, separate company (reported live,
  // 2026-09-04: a user hitting the old single "Go to the interview"
  // link with no idea pending got redirected to "/", which reads as
  // "logged out" — no dashboard chrome, marketing nav — and would have
  // created a second company had they continued).
  it("resumes the interview when one is genuinely still pending", async () => {
    getCharterState.mockRejectedValue(new Error("no org chart"));
    loadIdea.mockReturnValue("a laundromat");

    render(<CharterScreen />);

    await screen.findByText("You have an interview in progress — finish it to continue.");
    const link = screen.getByRole("link", { name: /Resume the interview/ });
    expect(link.getAttribute("href")).toBe("/interview");
  });

  it("honestly offers to start a new company, never claiming it edits this one, when no interview is pending", async () => {
    getCharterState.mockRejectedValue(new Error("no org chart"));
    loadIdea.mockReturnValue(null);

    render(<CharterScreen />);

    await screen.findByText("Starting a new interview creates a separate company — it won't change this one.");
    const link = screen.getByRole("link", { name: /Start a new company/ });
    expect(link.getAttribute("href")).toBe("/");
  });
});
