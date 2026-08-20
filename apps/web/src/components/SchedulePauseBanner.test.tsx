import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getSchedulerStatus = vi.fn();
const resumeSchedule = vi.fn();
vi.mock("../lib/schedulerClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/schedulerClient")>();
  return { ...actual, getSchedulerStatus: () => getSchedulerStatus(), resumeSchedule: () => resumeSchedule() };
});

import { SchedulePauseBanner } from "./SchedulePauseBanner";

afterEach(() => {
  cleanup();
  getSchedulerStatus.mockReset();
  resumeSchedule.mockReset();
});

describe("SchedulePauseBanner", () => {
  it("renders nothing for a healthy, unpaused tenant", async () => {
    getSchedulerStatus.mockResolvedValue({
      paused: false,
      pausedAt: null,
      pausedReason: null,
      remainingTaskCount: null,
      ceilingUsd: null,
      spentUsd: null,
    });

    const { container } = render(<SchedulePauseBanner />);
    await waitFor(() => expect(getSchedulerStatus).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the status check is still in flight or fails", async () => {
    getSchedulerStatus.mockRejectedValue(new Error("network down"));

    const { container } = render(<SchedulePauseBanner />);
    await waitFor(() => expect(getSchedulerStatus).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("shows what paused, why, and what it costs to resume — issue #140's minimum viable visibility", async () => {
    getSchedulerStatus.mockResolvedValue({
      paused: true,
      pausedAt: "2026-01-02T00:00:00.000Z",
      pausedReason: "ceiling-exhausted",
      remainingTaskCount: 2,
      ceilingUsd: 25,
      spentUsd: 26.5,
    });

    render(<SchedulePauseBanner />);

    expect(await screen.findByText("Your automation is paused")).toBeTruthy();
    expect(screen.getByText(/your monthly spend ceiling was reached/)).toBeTruthy();
    expect(screen.getByText(/2 tasks waiting/)).toBeTruthy();
    expect(screen.getByText(/\$26\.50 of your \$25\.00 monthly ceiling/)).toBeTruthy();
  });

  it("resumes the schedule and re-checks status on click", async () => {
    getSchedulerStatus
      .mockResolvedValueOnce({
        paused: true,
        pausedAt: "2026-01-02T00:00:00.000Z",
        pausedReason: "ceiling-exhausted",
        remainingTaskCount: 1,
        ceilingUsd: 25,
        spentUsd: 26.5,
      })
      .mockResolvedValueOnce({
        paused: false,
        pausedAt: null,
        pausedReason: null,
        remainingTaskCount: null,
        ceilingUsd: null,
        spentUsd: null,
      });
    resumeSchedule.mockResolvedValue(undefined);

    render(<SchedulePauseBanner />);
    await screen.findByText("Your automation is paused");

    fireEvent.click(screen.getByRole("button", { name: /resume/i }));

    await waitFor(() => expect(resumeSchedule).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Your automation is paused")).toBeNull());
  });

  it("shows an inline error and leaves the banner up when resume fails", async () => {
    getSchedulerStatus.mockResolvedValue({
      paused: true,
      pausedAt: "2026-01-02T00:00:00.000Z",
      pausedReason: "ceiling-exhausted",
      remainingTaskCount: 1,
      ceilingUsd: 25,
      spentUsd: 26.5,
    });
    resumeSchedule.mockRejectedValue(new Error("Could not resume your automation (500)."));

    render(<SchedulePauseBanner />);
    await screen.findByText("Your automation is paused");

    fireEvent.click(screen.getByRole("button", { name: /resume/i }));

    expect(await screen.findByText("Could not resume your automation (500).")).toBeTruthy();
    expect(screen.getByText("Your automation is paused")).toBeTruthy();
  });
});
