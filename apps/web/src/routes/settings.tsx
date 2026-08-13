import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsScreen } from "../components/SettingsScreen";
import { authClient } from "../lib/authClient";
import { resolveActiveOrganizationId } from "../lib/organizationClient";
import { serverAuthHeaders } from "../lib/serverAuthHeaders";

export const Route = createFileRoute("/settings")({
  beforeLoad: async () => {
    const headers = serverAuthHeaders();
    const { data } = await authClient.getSession({ fetchOptions: { headers } });
    if (!data) {
      throw redirect({ to: "/login" });
    }
    const activeOrganizationId = data.session.activeOrganizationId ?? (await resolveActiveOrganizationId(headers));
    if (!activeOrganizationId) {
      throw redirect({ to: "/onboarding" });
    }
  },
  component: SettingsScreen,
});
