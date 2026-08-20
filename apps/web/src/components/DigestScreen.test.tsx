import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const getDigest = vi.fn();
vi.mock("../lib/digestClient", () => ({
  getDigest: () => getDigest(),
}));

import { DigestScreen } from "./DigestScreen";

afterEach(() => {
  cleanup();
  getDigest.mockReset();
});

describe("DigestScreen", () => {
  it("shows real per-agent activity, pending approvals, and spend vs ceiling", async () => {
    getDigest.mockResolvedValue({
      tenantId: "tenant-1",
      date: "2026-08-20",
      agentActivity: [{ agentId: "agent-1", agentName: "Sam", taskCount: 3, spentUsd: 1.5 }],
      pendingApprovalCount: 2,
      spentUsd: 12.34,
      ceilingUsd: 50,
    });

    render(<DigestScreen />);

    expect(await screen.findByText("Sam")).toBeTruthy();
    expect(screen.getByText("3 tasks · $1.50")).toBeTruthy();
    expect(screen.getByText("2 items waiting on your approval.")).toBeTruthy();
    expect(screen.getByText("$12.34 of your $50.00 monthly ceiling.")).toBeTruthy();
  });

  it("says 'No agent activity today' rather than an empty list, when there's genuinely none", async () => {
    getDigest.mockResolvedValue({
      tenantId: "tenant-1",
      date: "2026-08-20",
      agentActivity: [],
      pendingApprovalCount: 0,
      spentUsd: 0,
      ceilingUsd: 50,
    });

    render(<DigestScreen />);

    expect(await screen.findByText("No agent activity today.")).toBeTruthy();
    expect(screen.getByText("Nothing waiting on your approval.")).toBeTruthy();
  });

  it("shows an honest empty state, not an error, when the tenant has no digest yet", async () => {
    getDigest.mockResolvedValue(null);

    render(<DigestScreen />);

    expect(await screen.findByText("Nothing to report yet")).toBeTruthy();
  });

  it("shows the real error message when the digest fails to load", async () => {
    getDigest.mockRejectedValue(new Error("Could not load today's digest (500)."));

    render(<DigestScreen />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Error: Could not load today's digest (500).")).toBeTruthy();
  });
});
