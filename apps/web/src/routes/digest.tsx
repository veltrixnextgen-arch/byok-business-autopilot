import { createFileRoute } from "@tanstack/react-router";
import { DigestScreen } from "../components/DigestScreen";
import { SessionCheckingScreen } from "../components/SessionCheckingScreen";
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

function DigestRoute() {
  const status = useAuthGuard(checkAuth);
  if (status !== "ready") return <SessionCheckingScreen />;
  return <DigestScreen />;
}

export const Route = createFileRoute("/digest")({
  component: DigestRoute,
});
