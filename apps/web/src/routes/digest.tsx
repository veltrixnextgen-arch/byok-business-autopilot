import { createFileRoute, redirect } from "@tanstack/react-router";
import { NotBuiltYetScreen } from "../components/NotBuiltYetScreen";
import { authClient } from "../lib/authClient";
import { resolveActiveOrganizationId } from "../lib/organizationClient";
import { serverAuthHeaders } from "../lib/serverAuthHeaders";

function DigestPlaceholder() {
  return (
    <NotBuiltYetScreen
      active="/digest"
      title="Digest"
      note="A daily/weekly summary of what your agents did isn't built yet — nothing to show here."
    />
  );
}

export const Route = createFileRoute("/digest")({
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
  component: DigestPlaceholder,
});
