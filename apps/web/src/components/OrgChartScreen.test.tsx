import type { OrgChart } from "@byok/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("../lib/extractionClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/extractionClient")>();
  return {
    ...actual,
    getLatestBatch: vi.fn(),
    recordFunnelEvent: vi.fn(),
    submitFeedback: vi.fn(),
    reassemble: vi.fn(),
    renameAgent: vi.fn(),
  };
});

import { getLatestBatch } from "../lib/extractionClient";
import { OrgChartScreen } from "./OrgChartScreen";

const CHART: OrgChart = {
  meta: { idea: "a barber shop", generatedAt: new Date().toISOString(), templateSelection: {} as never, calls: [], costUsd: 0 },
  teams: [{ id: "money", roleTitle: "Money", isHuman: false, agentIds: ["agent-1"] }],
  agents: [
    {
      id: "agent-1",
      name: "Alex",
      title: "Bookkeeper",
      teamId: "money",
      taskIds: ["task-1"],
      tier: "T1" as never,
      brain: null,
      hands: [],
      autonomyDefault: "review" as never,
      complianceLocked: false,
      requiresProfessionalVerification: false,
    },
  ],
  tasks: [
    {
      id: "task-1",
      text: "Log receipts",
      agentType: "agent-1",
      agentLabel: "Bookkeeper",
      teamHint: "money",
      frequency: "daily" as never,
      stakes: "low" as never,
      tier: "T1" as never,
      autonomy: "review" as never,
      handsTool: null,
    },
  ],
  customization: {} as never,
} as unknown as OrgChart;

beforeEach(() => {
  // useRevealStage() (OrgChartScreen.tsx) reads prefers-reduced-motion in
  // an effect — jsdom doesn't implement matchMedia at all. Stubbing it to
  // report reduced motion skips straight to the settled stage, same as a
  // real reduced-motion visitor, so the test doesn't need to wait through
  // the reveal's CSS-timed stages.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(getLatestBatch).mockReset();
});

// The reported bug: nothing exists after the org chart reveal — the
// feedback prompt answers and then it's a dead end for testers. This
// covers the fix: a closing state that always renders alongside the
// feedback prompt (not gated on answering it), naming what's next and
// linking back to the dashboard — no fake buttons, no invented screens.
describe("OrgChartScreen — closing state", () => {
  it("shows the closing state and a dashboard link once the chart settles", async () => {
    vi.mocked(getLatestBatch).mockResolvedValueOnce({
      id: "batch-1",
      idea: "a barber shop",
      status: "completed",
      orgChart: CHART,
      costUsd: 0.01,
      error: null,
    });

    render(<OrgChartScreen />);

    await waitFor(() => expect(screen.getByText(/that's the preview, in full/i)).toBeTruthy());
    expect(screen.getByText(/naming every agent, connecting your own ai key/i)).toBeTruthy();

    const link = screen.getByRole("link", { name: /back to your dashboard/i });
    expect(link.getAttribute("href")).toBe("/dashboard");
  });
});
