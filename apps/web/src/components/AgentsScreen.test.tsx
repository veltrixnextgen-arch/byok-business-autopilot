import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const getOrgChartForTenant = vi.fn();
vi.mock("../lib/extractionClient", () => ({
  getOrgChartForTenant: () => getOrgChartForTenant(),
}));

import { AgentsScreen } from "./AgentsScreen";

afterEach(() => {
  cleanup();
  getOrgChartForTenant.mockReset();
});

const AGENT = {
  id: "agent-1",
  name: "Priya",
  title: "Invoicing",
  objective: "Create and send invoices.",
  teamId: "cfo",
  taskIds: [],
  tier: "T1",
  brain: null,
  hands: ["quickbooks"],
  budget: { perDayUsd: 2, source: "tier-default" },
  reportingStructure: { teamId: "cfo", teamRoleTitle: "CFO" },
  autonomyDefault: "earnable",
  complianceLocked: false,
  requiresProfessionalVerification: false,
};

describe("AgentsScreen", () => {
  it("shows an honest empty state when there's no org chart yet — never fabricates agents", async () => {
    getOrgChartForTenant.mockResolvedValue(null);

    render(<AgentsScreen />);

    expect(await screen.findByText("No agents yet")).toBeTruthy();
  });

  it("lists real agents from the claimed org chart, including their real tools", async () => {
    getOrgChartForTenant.mockResolvedValue({
      id: "batch-1",
      status: "completed",
      orgChart: { agents: [AGENT], teams: [], tasks: [], meta: {} },
      error: null,
    });

    render(<AgentsScreen />);

    expect(await screen.findByText("Priya")).toBeTruthy();
    expect(screen.getByText("Invoicing")).toBeTruthy();
    expect(screen.getByText("Tools: quickbooks")).toBeTruthy();
  });

  it("shows the agent's real objective, reporting structure, and per-day budget", async () => {
    getOrgChartForTenant.mockResolvedValue({
      id: "batch-1",
      status: "completed",
      orgChart: { agents: [AGENT], teams: [], tasks: [], meta: {} },
      error: null,
    });

    render(<AgentsScreen />);

    expect(await screen.findByText("Create and send invoices.")).toBeTruthy();
    expect(screen.getByText(/Reports into CFO/)).toBeTruthy();
    expect(screen.getByText(/Up to \$2\/day/)).toBeTruthy();
  });
});
