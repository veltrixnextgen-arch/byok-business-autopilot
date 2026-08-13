import { createFileRoute, redirect } from "@tanstack/react-router";
import { ConnectScreen } from "../components/ConnectScreen";
import { authClient } from "../lib/authClient";
import { resolveActiveOrganizationId } from "../lib/organizationClient";
import { serverAuthHeaders } from "../lib/serverAuthHeaders";

export const Route = createFileRoute("/connect")({
  beforeLoad: async () => {
    const headers = serverAuthHeaders();
    const { data } = await authClient.getSession({ fetchOptions: { headers } });
    if (!data) {
      throw redirect({ to: "/login" });
    }
    // A user with no organization yet has nowhere for tenantMiddleware to
    // scope /me/brain-key or /me/ceiling to — same gate dashboard.tsx uses,
    // including the same activeOrganizationId-is-per-session fallback.
    const activeOrganizationId = data.session.activeOrganizationId ?? (await resolveActiveOrganizationId(headers));
    if (!activeOrganizationId) {
      throw redirect({ to: "/onboarding" });
    }
  },
  component: ConnectScreen,
});
