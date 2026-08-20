import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className, onClick }: { to: string; children: React.ReactNode; className?: string; onClick?: () => void }) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

const useSession = vi.fn();
vi.mock("../lib/authClient", () => ({
  useSession: () => useSession(),
}));

const listOrganizations = vi.fn();
const switchOrganization = vi.fn();
vi.mock("../lib/organizationClient", () => ({
  listOrganizations: () => listOrganizations(),
  switchOrganization: (id: string) => switchOrganization(id),
}));

const getApprovalsCount = vi.fn();
vi.mock("../lib/approvalsClient", () => ({
  getApprovalsCount: () => getApprovalsCount(),
}));

import { AppShell } from "./AppShell";

beforeEach(() => {
  getApprovalsCount.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
  useSession.mockReset();
  listOrganizations.mockReset();
  switchOrganization.mockReset();
  getApprovalsCount.mockReset();
});

describe("AppShell", () => {
  it("renders every nav item and highlights the active one", async () => {
    useSession.mockReturnValue({ data: { session: { activeOrganizationId: "org-1" } } });
    listOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00.000Z" }]);

    render(
      <AppShell active="/dashboard">
        <p>content</p>
      </AppShell>,
    );

    for (const label of ["Dashboard", "Company", "Agents", "Approvals", "Digest", "Spending", "Settings"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    const sidebarLink = screen.getByRole("link", { name: "Dashboard" });
    expect(sidebarLink.className).toContain("text-accent");
  });

  it("shows the active company's name once organizations load", async () => {
    useSession.mockReturnValue({ data: { session: { activeOrganizationId: "org-2" } } });
    listOrganizations.mockResolvedValue([
      { id: "org-1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "org-2", name: "Widgets Co", slug: "widgets-co", createdAt: "2026-02-01T00:00:00.000Z" },
    ]);

    render(
      <AppShell active="/dashboard">
        <p>content</p>
      </AppShell>,
    );

    await waitFor(() => expect(screen.getByText("Widgets Co")).toBeTruthy());
  });

  it("switches company and reloads when a different company is picked", async () => {
    useSession.mockReturnValue({ data: { session: { activeOrganizationId: "org-1" } } });
    listOrganizations.mockResolvedValue([
      { id: "org-1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "org-2", name: "Widgets Co", slug: "widgets-co", createdAt: "2026-02-01T00:00:00.000Z" },
    ]);
    switchOrganization.mockResolvedValue(undefined);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });

    render(
      <AppShell active="/dashboard">
        <p>content</p>
      </AppShell>,
    );

    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy());
    fireEvent.click(screen.getByText("Acme"));
    await waitFor(() => expect(screen.getByText("Widgets Co")).toBeTruthy());
    fireEvent.click(screen.getByText("Widgets Co"));

    await waitFor(() => expect(switchOrganization).toHaveBeenCalledWith("org-2"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/dashboard"));

    vi.unstubAllGlobals();
  });

  it("renders no companies message when the user has none", async () => {
    useSession.mockReturnValue({ data: { session: { activeOrganizationId: null } } });
    listOrganizations.mockResolvedValue([]);

    render(
      <AppShell active="/dashboard">
        <p>content</p>
      </AppShell>,
    );

    await waitFor(() => expect(screen.getByText("Select a company")).toBeTruthy());
    fireEvent.click(screen.getByText("Select a company"));
    expect(await screen.findByText("No companies yet.")).toBeTruthy();
  });

  it("shows a live count badge on Approvals when there are real pending items", async () => {
    useSession.mockReturnValue({ data: { session: { activeOrganizationId: "org-1" } } });
    listOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00.000Z" }]);
    getApprovalsCount.mockResolvedValue(15);

    render(
      <AppShell active="/dashboard">
        <p>content</p>
      </AppShell>,
    );

    expect(await screen.findByText("15")).toBeTruthy();
  });

  it("shows no badge when the count is zero", async () => {
    useSession.mockReturnValue({ data: { session: { activeOrganizationId: "org-1" } } });
    listOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00.000Z" }]);
    getApprovalsCount.mockResolvedValue(0);

    render(
      <AppShell active="/dashboard">
        <p>content</p>
      </AppShell>,
    );

    await waitFor(() => expect(getApprovalsCount).toHaveBeenCalled());
    expect(screen.queryByText("0")).toBeNull();
  });
});
