import { createFileRoute, redirect } from "@tanstack/react-router";
import { SpendingScreen } from "../components/SpendingScreen";
import { authClient } from "../lib/authClient";
import { resolveActiveOrganizationId } from "../lib/organizationClient";
import { serverAuthHeaders } from "../lib/serverAuthHeaders";

export const Route = createFileRoute("/spending")({
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
  component: SpendingScreen,
});
