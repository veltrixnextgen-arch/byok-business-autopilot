import { createFileRoute, redirect } from "@tanstack/react-router";
import { NotBuiltYetScreen } from "../components/NotBuiltYetScreen";
import { authClient } from "../lib/authClient";
import { resolveActiveOrganizationId } from "../lib/organizationClient";
import { serverAuthHeaders } from "../lib/serverAuthHeaders";

function ApprovalsPlaceholder() {
  return (
    <NotBuiltYetScreen
      active="/approvals"
      title="Approvals"
      note="The approval queue exists on the backend (packages/approval-queue) but nothing in the app surfaces it yet."
    />
  );
}

export const Route = createFileRoute("/approvals")({
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
  component: ApprovalsPlaceholder,
});
