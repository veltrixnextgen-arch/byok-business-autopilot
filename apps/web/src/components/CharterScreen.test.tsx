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
vi.mock("../lib/extractionClient", () => ({
  getOrgChartForTenant: () => getOrgChartForTenant(),
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
  // the interview for either an unfinished interview or someone who
  // wants to change their answers and regenerate.
  it("links back to the interview when there's no org chart to draft a Charter from yet", async () => {
    getCharterState.mockRejectedValue(new Error("no org chart"));

    render(<CharterScreen />);

    const link = await screen.findByRole("link", { name: /Go to the interview/ });
    expect(link.getAttribute("href")).toBe("/interview");
  });
});
