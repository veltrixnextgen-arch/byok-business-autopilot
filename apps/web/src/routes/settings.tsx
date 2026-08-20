import { createFileRoute } from "@tanstack/react-router";
import { SessionCheckingScreen } from "../components/SessionCheckingScreen";
import { SettingsScreen } from "../components/SettingsScreen";
import { authClient } from "../lib/authClient";
import { resolveActiveOrganizationId } from "../lib/organizationClient";
import { type GuardRedirectTarget, useAuthGuard } from "../lib/useAuthGuard";

export async function checkAuth(): Promise<GuardRedirectTarget | null> {
  const { data } = await authClient.getSession();
  if (!data) return "/login";
  const activeOrganizationId = data.session.activeOrganizationId ?? (await resolveActiveOrganizationId());
  if (!activeOrganizationId) return "/onboarding";
  return null;
}

function SettingsRoute() {
  const status = useAuthGuard(checkAuth);
  if (status !== "ready") return <SessionCheckingScreen />;
  return <SettingsScreen />;
}

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});
