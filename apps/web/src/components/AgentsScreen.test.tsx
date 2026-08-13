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
  teamId: "cfo",
  taskIds: [],
  tier: "T1",
  brain: null,
  hands: ["quickbooks"],
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
});
