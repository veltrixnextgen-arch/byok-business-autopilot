import { afterEach, describe, expect, it, vi } from "vitest";

const authClientFetch = vi.fn();
const organizationSetActive = vi.fn();
vi.mock("./authClient", () => ({
  authClient: {
    $fetch: (...args: unknown[]) => authClientFetch(...args),
    organization: {
      setActive: (...args: unknown[]) => organizationSetActive(...args),
    },
  },
}));

import { listOrganizations, resolveActiveOrganizationId, switchOrganization } from "./organizationClient";

afterEach(() => {
  authClientFetch.mockReset();
  organizationSetActive.mockReset();
});

// Bug: a fresh session's activeOrganizationId is null even for a user who
// already belongs to an organization from an earlier session — every
// route gating on activeOrganizationId alone treated a returning user
// identically to a brand-new signup. This is the lookup that closes the
// gap: find the user's real organizations and activate one before
// concluding "no organization."
describe("resolveActiveOrganizationId", () => {
  it("returns null when the user has no organizations", async () => {
    authClientFetch.mockResolvedValue({ data: [], error: null });

    expect(await resolveActiveOrganizationId()).toBeNull();
    expect(organizationSetActive).not.toHaveBeenCalled();
  });

  it("activates and returns the most recently created organization when one or more exist", async () => {
    authClientFetch.mockResolvedValue({
      data: [
        { id: "org-old", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "org-new", createdAt: "2026-06-01T00:00:00.000Z" },
      ],
      error: null,
    });
    organizationSetActive.mockResolvedValue({ error: null });

    expect(await resolveActiveOrganizationId()).toBe("org-new");
    expect(organizationSetActive).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-new" }));
  });

  it("returns null when setActive itself fails, rather than claiming an org is active that isn't", async () => {
    authClientFetch.mockResolvedValue({ data: [{ id: "org-1", createdAt: "2026-01-01T00:00:00.000Z" }], error: null });
    organizationSetActive.mockResolvedValue({ error: { message: "failed" } });

    expect(await resolveActiveOrganizationId()).toBeNull();
  });

  it("forwards provided headers to both the list and setActive calls — the SSR cross-site-cookie fix", async () => {
    authClientFetch.mockResolvedValue({ data: [{ id: "org-1", createdAt: "2026-01-01T00:00:00.000Z" }], error: null });
    organizationSetActive.mockResolvedValue({ error: null });
    const headers = { cookie: "session=abc" };

    await resolveActiveOrganizationId(headers);

    expect(authClientFetch).toHaveBeenCalledWith("/organization/list", expect.objectContaining({ headers }));
    expect(organizationSetActive).toHaveBeenCalledWith(expect.objectContaining({ fetchOptions: { headers } }));
  });
});

// The company switcher's data source — client-side only, so no headers
// to forward (a real browser fetch already carries the session cookie).
describe("listOrganizations", () => {
  it("returns the organization list", async () => {
    const orgs = [{ id: "org-1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00.000Z" }];
    authClientFetch.mockResolvedValue({ data: orgs, error: null });

    expect(await listOrganizations()).toEqual(orgs);
    expect(authClientFetch).toHaveBeenCalledWith("/organization/list", { method: "GET" });
  });

  it("returns an empty array rather than null/undefined when the fetch yields no data", async () => {
    authClientFetch.mockResolvedValue({ data: null, error: { message: "failed" } });

    expect(await listOrganizations()).toEqual([]);
  });
});

describe("switchOrganization", () => {
  it("calls setActive with the given organization id", async () => {
    organizationSetActive.mockResolvedValue({ error: null });

    await switchOrganization("org-2");

    expect(organizationSetActive).toHaveBeenCalledWith({ organizationId: "org-2" });
  });

  it("throws when setActive fails, so the switcher can show a real error instead of silently no-op'ing", async () => {
    organizationSetActive.mockResolvedValue({ error: { message: "nope" } });

    await expect(switchOrganization("org-2")).rejects.toThrow("nope");
  });
});
