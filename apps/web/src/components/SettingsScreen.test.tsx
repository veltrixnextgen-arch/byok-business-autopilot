import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("./AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const useSession = vi.fn();
vi.mock("../lib/authClient", () => ({
  useSession: () => useSession(),
}));

const getBrainKeyStatus = vi.fn();
const getCeiling = vi.fn();
vi.mock("../lib/brainKeyClient", () => ({
  getBrainKeyStatus: () => getBrainKeyStatus(),
  getCeiling: () => getCeiling(),
}));

const getOrgChartForTenant = vi.fn();
vi.mock("../lib/extractionClient", () => ({
  getOrgChartForTenant: () => getOrgChartForTenant(),
}));

const getHandsKeyStatus = vi.fn();
vi.mock("../lib/handsKeyClient", () => ({
  getHandsKeyStatus: (agentId: string, tool: string) => getHandsKeyStatus(agentId, tool),
}));

import { SettingsScreen } from "./SettingsScreen";

afterEach(() => {
  cleanup();
  useSession.mockReset();
  getBrainKeyStatus.mockReset();
  getCeiling.mockReset();
  getOrgChartForTenant.mockReset();
  getHandsKeyStatus.mockReset();
});

const AGENT = { id: "agent-1", name: "Priya", hands: ["quickbooks"] };

describe("SettingsScreen", () => {
  it("shows real profile, brain key, ceiling, and hands data — and an honest gap for notifications", async () => {
    useSession.mockReturnValue({ data: { user: { name: "Alex Founder", email: "alex@example.com" } } });
    getBrainKeyStatus.mockResolvedValue({ id: "k1", provider: "anthropic", maskedFingerprint: "sk-...4f2a", createdAt: "" });
    getCeiling.mockResolvedValue({ companyMonthlyUsd: 50, isOverride: true });
    getOrgChartForTenant.mockResolvedValue({ id: "b1", status: "completed", orgChart: { agents: [AGENT] }, error: null });
    getHandsKeyStatus.mockResolvedValue({ id: "h1", service: "quickbooks", maskedFingerprint: "***", createdAt: "" });

    render(<SettingsScreen />);

    expect(await screen.findByText("Alex Founder")).toBeTruthy();
    expect(screen.getByText("alex@example.com")).toBeTruthy();
    expect(screen.getByText("sk-...4f2a")).toBeTruthy();
    expect(await screen.findByText("quickbooks")).toBeTruthy();
    expect(screen.getByText("Priya")).toBeTruthy();
    expect(await screen.findByText("$50.00")).toBeTruthy();
    expect(screen.getByText("Notification preferences aren't available yet.")).toBeTruthy();
  });

  it("shows honest empty/not-connected states rather than fabricating data", async () => {
    useSession.mockReturnValue({ data: { user: { name: "", email: "alex@example.com" } } });
    getBrainKeyStatus.mockResolvedValue(null);
    getCeiling.mockResolvedValue({ companyMonthlyUsd: 50, isOverride: false });
    getOrgChartForTenant.mockResolvedValue(null);

    render(<SettingsScreen />);

    expect(await screen.findByText("Not connected yet.")).toBeTruthy();
    expect(await screen.findByText(/no agents need a tool connection yet/i)).toBeTruthy();
  });
});
