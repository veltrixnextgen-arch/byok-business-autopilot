import { authClient } from "./authClient";

interface OrganizationSummary {
  id: string;
  createdAt: string;
}

// A fresh session's `activeOrganizationId` is null even for a user who
// already belongs to an organization from an earlier session — Better
// Auth's organization plugin requires an explicit setActive call per
// session; it never infers "this user has an org, so make it active."
// Every route that gates on activeOrganizationId alone treated a
// returning user identically to a brand-new signup and routed them to
// /onboarding, where the form could only fail ("Organization already
// exists"). This resolves the gap: look up the user's real organizations
// and, if any exist, activate the most recent one on this session before
// falling back to "this user genuinely has none yet."
export async function resolveActiveOrganizationId(headers?: Record<string, string>): Promise<string | null> {
  const fetchOptions = headers ? { headers } : undefined;
  const { data: organizations } = await authClient.$fetch<OrganizationSummary[]>("/organization/list", {
    method: "GET",
    ...fetchOptions,
  });
  if (!organizations || organizations.length === 0) return null;

  const mostRecent = organizations.reduce((latest, org) => (new Date(org.createdAt) > new Date(latest.createdAt) ? org : latest));
  const { error } = await authClient.organization.setActive({
    organizationId: mostRecent.id,
    fetchOptions,
  });
  return error ? null : mostRecent.id;
}
