import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  redirect: (opts: unknown) => opts,
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("../lib/authClient", () => ({
  authClient: { getSession: vi.fn(), $fetch: vi.fn(), organization: { setActive: vi.fn() } },
}));

import { authClient } from "../lib/authClient";
import { saveIdea } from "../lib/extractionClient";
import { Route } from "./dashboard";

afterEach(() => {
  sessionStorage.clear();
  vi.mocked(authClient.getSession).mockReset();
  vi.mocked(authClient.$fetch).mockReset();
  vi.mocked(authClient.organization.setActive).mockReset();
});

async function getRedirectTarget(): Promise<string | undefined> {
  try {
    // biome-ignore lint: real beforeLoad ignores its argument entirely
    await (Route as unknown as { beforeLoad: () => Promise<void> }).beforeLoad();
    return undefined;
  } catch (thrown) {
    return (thrown as { to: string }).to;
  }
}

// The reported bug: a signed-in user with a pending idea (interview never
// finished) landed on /dashboard's Step-1 placeholder instead of the
// interview, no matter which path got them there. This is the backstop —
// /dashboard itself now refuses to render for anyone still holding a
// pending idea, regardless of how they arrived.
describe("dashboard beforeLoad — idea/org guard", () => {
  it("redirects to /login when signed out", async () => {
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: null } as never);
    expect(await getRedirectTarget()).toBe("/login");
  });

  it("redirects to /onboarding when signed in with no active organization and no organization to fall back to", async () => {
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: { session: { activeOrganizationId: null } } } as never);
    vi.mocked(authClient.$fetch).mockResolvedValueOnce({ data: [], error: null } as never);
    expect(await getRedirectTarget()).toBe("/onboarding");
  });

  // The bug this backstops: a returning user's fresh session has no
  // active organization set (Better Auth requires an explicit setActive
  // per session) even though they already own one — without this
  // fallback they were bounced to /onboarding on every fresh login.
  it("does not redirect to /onboarding when activeOrganizationId is null but the user already owns an organization", async () => {
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: { session: { activeOrganizationId: null } } } as never);
    vi.mocked(authClient.$fetch).mockResolvedValueOnce({
      data: [{ id: "org_1", createdAt: "2026-01-01T00:00:00.000Z" }],
      error: null,
    } as never);
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({ error: null } as never);
    expect(await getRedirectTarget()).toBeUndefined();
  });

  it("redirects to /interview when a pending idea exists, even with an active organization", async () => {
    saveIdea("a pending idea");
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: { session: { activeOrganizationId: "org_1" } } } as never);
    expect(await getRedirectTarget()).toBe("/interview");
  });

  it("renders normally (no redirect) with an active organization and no pending idea", async () => {
    vi.mocked(authClient.getSession).mockResolvedValueOnce({ data: { session: { activeOrganizationId: "org_1" } } } as never);
    expect(await getRedirectTarget()).toBeUndefined();
  });
});
