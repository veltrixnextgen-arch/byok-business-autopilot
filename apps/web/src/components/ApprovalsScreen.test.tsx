import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const getApprovals = vi.fn();
const resolveApproval = vi.fn();
const acceptAutonomyOffer = vi.fn();
vi.mock("../lib/approvalsClient", () => ({
  getApprovals: () => getApprovals(),
  resolveApproval: (id: string, kind: string, verdict: unknown) => resolveApproval(id, kind, verdict),
  acceptAutonomyOffer: (taskType: string) => acceptAutonomyOffer(taskType),
}));

import { ApprovalsScreen } from "./ApprovalsScreen";

const ACTION = {
  id: "action-1",
  kind: "action" as const,
  agentName: "Sam",
  roleTitle: "Expenses",
  taskType: "agent-1",
  title: "Categorize expenses",
  output: "Categorized 12 transactions.",
  effectDescription: "Posts the categorized transactions to QuickBooks.",
  stakesTags: [],
  neverEarnsAutonomy: false,
  costUsd: 1.5,
  createdAt: "2026-08-20T01:00:00.000Z",
};

const DENY_ACTION = {
  ...ACTION,
  id: "action-2",
  neverEarnsAutonomy: true,
  createdAt: "2026-08-20T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  getApprovals.mockReset();
  resolveApproval.mockReset();
  acceptAutonomyOffer.mockReset();
});

describe("ApprovalsScreen", () => {
  it("shows an honest empty state when nothing is pending", async () => {
    getApprovals.mockResolvedValue({ items: [], autonomyStatus: [] });
    render(<ApprovalsScreen />);
    expect(await screen.findByText("Nothing waiting on you")).toBeTruthy();
  });

  it("shows the real agent name, title, output, and 'if you approve' text for one item", async () => {
    getApprovals.mockResolvedValue({ items: [ACTION], autonomyStatus: [] });
    render(<ApprovalsScreen />);

    expect(await screen.findByText("Sam")).toBeTruthy();
    expect(screen.getByText("Expenses")).toBeTruthy();
    expect(screen.getByText("Categorize expenses")).toBeTruthy();
    expect(screen.getByText("Categorized 12 transactions.")).toBeTruthy();
    expect(screen.getByText("Posts the categorized transactions to QuickBooks.")).toBeTruthy();
    expect(screen.getByText("Item 1 of 1")).toBeTruthy();
  });

  it("shows the honest fallback when an action has no effect to approve", async () => {
    getApprovals.mockResolvedValue({ items: [{ ...ACTION, effectDescription: null }], autonomyStatus: [] });
    render(<ApprovalsScreen />);
    expect(await screen.findByText(/Nothing further happens/)).toBeTruthy();
  });

  it("marks a deny-listed item as never earning autonomy", async () => {
    getApprovals.mockResolvedValue({ items: [DENY_ACTION], autonomyStatus: [] });
    render(<ApprovalsScreen />);
    expect(await screen.findByText("Never earns autonomy")).toBeTruthy();
  });

  it("Approve calls resolveApproval with APPROVE and removes the item from the queue", async () => {
    getApprovals.mockResolvedValue({ items: [ACTION], autonomyStatus: [] });
    resolveApproval.mockResolvedValue({ resolved: true, dispatched: true });
    render(<ApprovalsScreen />);

    await screen.findByText("Sam");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(resolveApproval).toHaveBeenCalledWith("action-1", "action", { kind: "APPROVE" }));
    await waitFor(() => expect(screen.getByText("Nothing waiting on you")).toBeTruthy());
  });

  it("Reject requires feedback before the confirm button is enabled", async () => {
    getApprovals.mockResolvedValue({ items: [ACTION], autonomyStatus: [] });
    render(<ApprovalsScreen />);

    await screen.findByText("Sam");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    const confirmButton = screen.getByRole("button", { name: "Confirm reject" });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText(/Why\?/), { target: { value: "wrong amount" } });
    expect(confirmButton.hasAttribute("disabled")).toBe(false);

    resolveApproval.mockResolvedValue({ resolved: true, dispatched: false });
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(resolveApproval).toHaveBeenCalledWith("action-1", "action", { kind: "REJECT", feedback: "wrong amount" }),
    );
  });

  it("Modify pre-fills the output and submits the edited text", async () => {
    getApprovals.mockResolvedValue({ items: [ACTION], autonomyStatus: [] });
    resolveApproval.mockResolvedValue({ resolved: true, dispatched: true });
    render(<ApprovalsScreen />);

    await screen.findByText("Sam");
    fireEvent.click(screen.getByRole("button", { name: "Modify" }));

    const textarea = screen.getByLabelText(/Edit the output/) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Categorized 12 transactions.");

    fireEvent.change(textarea, { target: { value: "Categorized 13 transactions, one corrected." } });
    fireEvent.click(screen.getByRole("button", { name: "Approve with edits" }));

    await waitFor(() =>
      expect(resolveApproval).toHaveBeenCalledWith("action-1", "action", {
        kind: "MODIFY",
        editedOutput: "Categorized 13 transactions, one corrected.",
      }),
    );
  });

  it("shows an honest empty state for autonomy status when there's no history yet", async () => {
    getApprovals.mockResolvedValue({ items: [], autonomyStatus: [] });
    render(<ApprovalsScreen />);
    expect(await screen.findByText(/No autonomy history yet/)).toBeTruthy();
  });

  it("shows real autonomy progress and an Accept button only when a real offer is pending", async () => {
    getApprovals.mockResolvedValue({
      items: [],
      autonomyStatus: [
        { taskType: "agent-1", active: false, consecutiveApprovals: 10, offeredAt: "2026-08-20T00:00:00.000Z" },
        { taskType: "agent-2", active: false, consecutiveApprovals: 4, offeredAt: null },
      ],
    });
    render(<ApprovalsScreen />);

    expect(await screen.findByText("agent-1")).toBeTruthy();
    expect(screen.getByText("4/10 toward offer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept autonomy" })).toBeTruthy();
  });

  it("Accept autonomy calls acceptAutonomyOffer with the real task type", async () => {
    getApprovals.mockResolvedValue({
      items: [],
      autonomyStatus: [{ taskType: "agent-1", active: false, consecutiveApprovals: 10, offeredAt: "2026-08-20T00:00:00.000Z" }],
    });
    acceptAutonomyOffer.mockResolvedValue(undefined);
    render(<ApprovalsScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Accept autonomy" }));
    await waitFor(() => expect(acceptAutonomyOffer).toHaveBeenCalledWith("agent-1"));
  });
});
