import { createFileRoute } from "@tanstack/react-router";
import { NotBuiltYetScreen } from "../components/NotBuiltYetScreen";
import { SessionCheckingScreen } from "../components/SessionCheckingScreen";
import { authClient } from "../lib/authClient";
import { resolveActiveOrganizationId } from "../lib/organizationClient";
import { type GuardRedirectTarget, useAuthGuard } from "../lib/useAuthGuard";

function ApprovalsPlaceholder() {
  return (
    <NotBuiltYetScreen
      active="/approvals"
      title="Approvals"
      note="The approval queue exists on the backend (packages/approval-queue) but nothing in the app surfaces it yet."
    />
  );
}

export async function checkAuth(): Promise<GuardRedirectTarget | null> {
  const { data } = await authClient.getSession();
  if (!data) return "/login";
  const activeOrganizationId = data.session.activeOrganizationId ?? (await resolveActiveOrganizationId());
  if (!activeOrganizationId) return "/onboarding";
  return null;
}

function ApprovalsRoute() {
  const status = useAuthGuard(checkAuth);
  if (status !== "ready") return <SessionCheckingScreen />;
  return <ApprovalsPlaceholder />;
}

export const Route = createFileRoute("/approvals")({
  component: ApprovalsRoute,
});
