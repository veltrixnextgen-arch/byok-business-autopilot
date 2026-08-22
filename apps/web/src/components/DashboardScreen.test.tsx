import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

// AppShell has its own test file and its own real network calls
// (company list, session) — tested in isolation there, not re-exercised
// here on every DashboardScreen test.
vi.mock("./AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const meGet = vi.fn();
const dashboardGet = vi.fn();
vi.mock("../lib/apiClient", () => ({
  apiClient: { me: { $get: () => meGet() }, dashboard: { $get: () => dashboardGet() } },
}));

const getOrgChartForTenant = vi.fn();
vi.mock("../lib/extractionClient", () => ({
  getOrgChartForTenant: () => getOrgChartForTenant(),
}));

const getBrainKeyStatus = vi.fn();
vi.mock("../lib/brainKeyClient", () => ({
  getBrainKeyStatus: () => getBrainKeyStatus(),
}));

import { DashboardScreen } from "./DashboardScreen";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const ME = { userId: "user-1", email: "founder@example.com", tenantId: "tenant-1" };
const CONNECTED_KEY = { id: "key-1", provider: "anthropic", maskedFingerprint: "sk-...4f2a", createdAt: new Date().toISOString(), decryptable: true };

afterEach(() => {
  cleanup();
  meGet.mockReset();
  dashboardGet.mockReset();
  getOrgChartForTenant.mockReset();
  getBrainKeyStatus.mockReset();
});

describe("DashboardScreen", () => {
  it("shows honest empty states for panels with no real data source, even once loaded", async () => {
    meGet.mockResolvedValue(jsonResponse(ME));
    dashboardGet.mockResolvedValue(jsonResponse({ spendByRoleAllTime: [], spendByRoleToday: [], recentActivity: [] }));
    getOrgChartForTenant.mockResolvedValue(null);
    getBrainKeyStatus.mockResolvedValue(CONNECTED_KEY);

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
    getOrgChartForTenant.mockResolvedValue(null);
    getBrainKeyStatus.mockResolvedValue(CONNECTED_KEY);

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
    getOrgChartForTenant.mockResolvedValue({
      id: "batch-1",
      status: "completed",
      orgChart: { teams: [{ id: "cfo", roleTitle: "Finance Lead" }] },
      error: null,
    });
    getBrainKeyStatus.mockResolvedValue(CONNECTED_KEY);

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
    getOrgChartForTenant.mockResolvedValue(null);
    getBrainKeyStatus.mockResolvedValue(CONNECTED_KEY);

    render(<DashboardScreen />);

    expect(await screen.findByText("Approved")).toBeTruthy();
  });

  it("shows a Connect a Brain CTA when no key is connected yet", async () => {
    meGet.mockResolvedValue(jsonResponse(ME));
    dashboardGet.mockResolvedValue(jsonResponse({ spendByRoleAllTime: [], spendByRoleToday: [], recentActivity: [] }));
    getOrgChartForTenant.mockResolvedValue(null);
    getBrainKeyStatus.mockResolvedValue(null);

    render(<DashboardScreen />);

    expect(await screen.findByText("Connect a Brain to get started")).toBeTruthy();
    const link = screen.getByRole("link", { name: /connect a brain/i });
    expect(link.getAttribute("href")).toBe("/connect");
  });

  it("does not show the Connect a Brain CTA once a key is connected", async () => {
    meGet.mockResolvedValue(jsonResponse(ME));
    dashboardGet.mockResolvedValue(jsonResponse({ spendByRoleAllTime: [], spendByRoleToday: [], recentActivity: [] }));
    getOrgChartForTenant.mockResolvedValue(null);
    getBrainKeyStatus.mockResolvedValue(CONNECTED_KEY);

    render(<DashboardScreen />);

    await waitFor(() => expect(screen.getByText("Signed in as founder@example.com")).toBeTruthy());
    expect(screen.queryByText("Connect a Brain to get started")).toBeNull();
  });

  // ADR-031: a key row existing ("connected") is a different fact than
  // its material still being decryptable — a rotated KMS master key is
  // the realistic cause. This must surface as its own distinct banner,
  // not silently look identical to "connected and working."
  it("shows a reconnect banner (not the Connect CTA) when the key is connected but not decryptable", async () => {
    meGet.mockResolvedValue(jsonResponse(ME));
    dashboardGet.mockResolvedValue(jsonResponse({ spendByRoleAllTime: [], spendByRoleToday: [], recentActivity: [] }));
    getOrgChartForTenant.mockResolvedValue(null);
    getBrainKeyStatus.mockResolvedValue({ ...CONNECTED_KEY, decryptable: false });

    render(<DashboardScreen />);

    expect(await screen.findByText("Your connected Brain key can't be used right now")).toBeTruthy();
    expect(screen.queryByText("Connect a Brain to get started")).toBeNull();
    const link = screen.getByRole("link", { name: /reconnect/i });
    expect(link.getAttribute("href")).toBe("/connect");
  });

  it("shows neither the Connect CTA nor the reconnect banner for a connected, decryptable key", async () => {
    meGet.mockResolvedValue(jsonResponse(ME));
    dashboardGet.mockResolvedValue(jsonResponse({ spendByRoleAllTime: [], spendByRoleToday: [], recentActivity: [] }));
    getOrgChartForTenant.mockResolvedValue(null);
    getBrainKeyStatus.mockResolvedValue(CONNECTED_KEY);

    render(<DashboardScreen />);

    await waitFor(() => expect(screen.getByText("Signed in as founder@example.com")).toBeTruthy());
    expect(screen.queryByText("Connect a Brain to get started")).toBeNull();
    expect(screen.queryByText("Your connected Brain key can't be used right now")).toBeNull();
  });
});
