import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const getCeiling = vi.fn();
const setCeiling = vi.fn();
vi.mock("../lib/brainKeyClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/brainKeyClient")>();
  return { ...actual, getCeiling: () => getCeiling(), setCeiling: (v: number) => setCeiling(v) };
});

import { SpendingScreen } from "./SpendingScreen";

afterEach(() => {
  cleanup();
  getCeiling.mockReset();
  setCeiling.mockReset();
});

describe("SpendingScreen", () => {
  it("shows the real ceiling and whether it's a platform default or the tenant's own override", async () => {
    getCeiling.mockResolvedValue({ companyMonthlyUsd: 50, isOverride: false });

    render(<SpendingScreen />);

    expect(await screen.findByText("Platform default — not yet customized")).toBeTruthy();
    expect(screen.getByDisplayValue("50")).toBeTruthy();
  });

  it("saves an edited ceiling and reflects the new override state", async () => {
    getCeiling.mockResolvedValue({ companyMonthlyUsd: 50, isOverride: false });
    setCeiling.mockResolvedValue({ companyMonthlyUsd: 75, isOverride: true });

    render(<SpendingScreen />);
    await screen.findByDisplayValue("50");

    fireEvent.change(screen.getByLabelText("Monthly ceiling (USD)"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: /save ceiling/i }));

    await waitFor(() => expect(setCeiling).toHaveBeenCalledWith(75));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(screen.getByText("Your ceiling")).toBeTruthy();
  });
});
