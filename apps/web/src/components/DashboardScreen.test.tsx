import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const meGet = vi.fn();
const dashboardGet = vi.fn();
vi.mock("../lib/apiClient", () => ({
  apiClient: { me: { $get: () => meGet() }, dashboard: { $get: () => dashboardGet() } },
}));

const getLatestBatch = vi.fn();
vi.mock("../lib/extractionClient", () => ({
  getLatestBatch: () => getLatestBatch(),
}));

import { DashboardScreen } from "./DashboardScreen";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const ME = { userId: "user-1", email: "founder@example.com", tenantId: "tenant-1" };

afterEach(() => {
  cleanup();
  meGet.mockReset();
  dashboardGet.mockReset();
  getLatestBatch.mockReset();
});

describe("DashboardScreen", () => {
  it("shows honest empty states for panels with no real data source, even once loaded", async () => {
    meGet.mockResolvedValue(jsonResponse(ME));
    dashboardGet.mockResolvedValue(jsonResponse({ spendByRoleAllTime: [], spendByRoleToday: [], recentActivity: [] }));
    getLatestBatch.mockResolvedValue(null);

    render(<DashboardScreen />);

    await waitFor(() => expect(screen.getByText("Signed in as founder@example.com")).toBeTruthy());
    // "Agents active", "Work completed today", "Approvals waiting" have no
    // backing query at all — must never show a fabricated number.
    expect(screen.getByText("Agents active")).toBeTruthy();
    expect(screen.getByText("Work completed today")).toBeTruthy();
    expect(screen.getByText("Approvals waiting")).toBeTruthy();
    expect(screen.getAllByText("Not tracked yet").length).toBe(3);
    expect(screen.getByText("Cost-saving suggestions aren't available yet.")).toBeTruthy();
  });

  it("shows a real spend-today total and cost-by-team breakdown once /dashboard resolves", async () => {
    meGet.mockResolvedValue(jsonResponse(ME));
    dashboardGet.mockResolvedValue(
      jsonResponse({
        spendByRoleAllTime: [
          { key: "cfo", totalUsd: 8 },
          { key: "cmo", totalUsd: 2 },
        ],
        spendByRoleToday: [{ key: "cfo", totalUsd: 1.5 }],
        recentActivity: [],
      }),
    );
    getLatestBatch.mockResolvedValue(null);

    render(<DashboardScreen />);

    expect(await screen.findByText("$1.50")).toBeTruthy();
    expect(await screen.findByText("$8.00")).toBeTruthy();
    expect(screen.getByText("$2.00")).toBeTruthy();
  });

  it("uses the org chart's real team titles instead of raw role ids when a completed batch exists", async () => {
    meGet.mockResolvedValue(jsonResponse(ME));
    dashboardGet.mockResolvedValue(
      jsonResponse({ spendByRoleAllTime: [{ key: "cfo", totalUsd: 4 }], spendByRoleToday: [], recentActivity: [] }),
    );
    getLatestBatch.mockResolvedValue({
      id: "batch-1",
      status: "completed",
      orgChart: { teams: [{ id: "cfo", roleTitle: "Finance Lead" }] },
      error: null,
    });

    render(<DashboardScreen />);

    expect(await screen.findByText("Finance Lead")).toBeTruthy();
    expect(await screen.findByRole("link", { name: /view your org chart/i })).toBeTruthy();
  });

  it("renders recent activity with a human-readable label, not the raw event kind", async () => {
    meGet.mockResolvedValue(jsonResponse(ME));
    dashboardGet.mockResolvedValue(
      jsonResponse({
        spendByRoleAllTime: [],
        spendByRoleToday: [],
        recentActivity: [{ id: "evt-1", source: "approval-queue", kind: "APPROVE", at: new Date().toISOString() }],
      }),
    );
    getLatestBatch.mockResolvedValue(null);

    render(<DashboardScreen />);

    expect(await screen.findByText("Approved")).toBeTruthy();
  });
});
