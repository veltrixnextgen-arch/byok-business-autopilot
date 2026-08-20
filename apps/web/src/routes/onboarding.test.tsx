import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));

vi.mock("../lib/authClient", () => ({
  authClient: { getSession: vi.fn(), $fetch: vi.fn(), organization: { setActive: vi.fn() } },
}));

import { authClient } from "../lib/authClient";
import { checkAuth } from "./onboarding";

afterEach(() => {
  vi.mocked(authClient.getSession).mockReset();
  vi.mocked(authClient.$fetch).mockReset();
  vi.mocked(authClient.organization.setActive).mockReset();
});

describe("onboarding checkAuth — existing-org guard", () => {
  it("redirects to /login when signed out", async () => {
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: null } as never);
    expect(await checkAuth()).toBe("/login");
  });

  it("renders the form (no redirect) when signed in with genuinely no organization", async () => {
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: { session: { activeOrganizationId: null } } } as never);
    vi.mocked(authClient.$fetch).mockResolvedValueOnce({ data: [], error: null } as never);
    expect(await checkAuth()).toBeNull();
  });

  it("redirects to /dashboard when the session already has an active organization", async () => {
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: { session: { activeOrganizationId: "org_1" } } } as never);
    expect(await checkAuth()).toBe("/dashboard");
  });

  // The reported bug: a returning user's fresh session has no active
  // organization even though they already own one, so this screen's
  // "name your company" form could only ever fail for them
  // ("Organization already exists"). This is the fix — detect the
  // existing organization and skip the form entirely.
  it("redirects to /dashboard when activeOrganizationId is null but the user already owns an organization", async () => {
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: { session: { activeOrganizationId: null } } } as never);
    vi.mocked(authClient.$fetch).mockResolvedValueOnce({
      data: [{ id: "org_1", createdAt: "2026-01-01T00:00:00.000Z" }],
      error: null,
    } as never);
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({ error: null } as never);
    expect(await checkAuth()).toBe("/dashboard");
  });
});
