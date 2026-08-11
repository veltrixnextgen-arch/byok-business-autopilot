import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

const organizationCreate = vi.fn();
const organizationSetActive = vi.fn();
vi.mock("../lib/authClient", () => ({
  authClient: {
    organization: {
      create: (...args: unknown[]) => organizationCreate(...args),
      setActive: (...args: unknown[]) => organizationSetActive(...args),
    },
  },
}));

const claimOrgChart = vi.fn();
const loadIdea = vi.fn();
vi.mock("../lib/extractionClient", () => ({
  claimOrgChart: () => claimOrgChart(),
  loadIdea: () => loadIdea(),
}));

import { OnboardingScreen } from "./OnboardingScreen";

afterEach(() => {
  cleanup();
  navigate.mockReset();
  organizationCreate.mockReset();
  organizationSetActive.mockReset();
  claimOrgChart.mockReset();
  loadIdea.mockReset();
});

// Issue #38: the org-chart -> tenant handoff is triggered right after org
// creation succeeds, today's earliest point a tenant exists.
describe("OnboardingScreen — org-chart handoff (issue #38)", () => {
  it("claims the org chart after org creation succeeds, before navigating on", async () => {
    organizationCreate.mockResolvedValue({ data: { id: "org-1" }, error: null });
    organizationSetActive.mockResolvedValue({ error: null });
    claimOrgChart.mockResolvedValue({ id: "batch-1", status: "completed" });
    loadIdea.mockReturnValue(null);

    render(<OnboardingScreen />);
    fireEvent.change(screen.getByPlaceholderText("Acme Studio"), { target: { value: "Acme Studio" } });
    fireEvent.click(screen.getByRole("button", { name: /create company/i }));

    await waitFor(() => expect(claimOrgChart).toHaveBeenCalledOnce());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/dashboard" }));
  });

  it("still navigates on when there is nothing eligible to claim — a non-blocking, best-effort step", async () => {
    organizationCreate.mockResolvedValue({ data: { id: "org-1" }, error: null });
    organizationSetActive.mockResolvedValue({ error: null });
    claimOrgChart.mockRejectedValue(new Error("nothing to claim"));
    loadIdea.mockReturnValue(null);

    render(<OnboardingScreen />);
    fireEvent.change(screen.getByPlaceholderText("Acme Studio"), { target: { value: "Acme Studio" } });
    fireEvent.click(screen.getByRole("button", { name: /create company/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/dashboard" }));
  });

  it("routes to the interview instead of the dashboard when an idea is still pending", async () => {
    organizationCreate.mockResolvedValue({ data: { id: "org-1" }, error: null });
    organizationSetActive.mockResolvedValue({ error: null });
    claimOrgChart.mockResolvedValue(null);
    loadIdea.mockReturnValue("a barber shop");

    render(<OnboardingScreen />);
    fireEvent.change(screen.getByPlaceholderText("Acme Studio"), { target: { value: "Acme Studio" } });
    fireEvent.click(screen.getByRole("button", { name: /create company/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/interview" }));
  });
});
