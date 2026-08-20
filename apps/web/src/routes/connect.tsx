import { createFileRoute } from "@tanstack/react-router";
import { ConnectScreen } from "../components/ConnectScreen";
import { SessionCheckingScreen } from "../components/SessionCheckingScreen";
import { authClient } from "../lib/authClient";
import { resolveActiveOrganizationId } from "../lib/organizationClient";
import { type GuardRedirectTarget, useAuthGuard } from "../lib/useAuthGuard";

// A user with no organization yet has nowhere for tenantMiddleware to
// scope /me/brain-key or /me/ceiling to — same gate dashboard.tsx uses,
// including the same activeOrganizationId-is-per-session fallback.
export async function checkAuth(): Promise<GuardRedirectTarget | null> {
  const { data } = await authClient.getSession();
  if (!data) return "/login";
  const activeOrganizationId = data.session.activeOrganizationId ?? (await resolveActiveOrganizationId());
  if (!activeOrganizationId) return "/onboarding";
  return null;
}

function ConnectRoute() {
  const status = useAuthGuard(checkAuth);
  if (status !== "ready") return <SessionCheckingScreen />;
  return <ConnectScreen />;
}

export const Route = createFileRoute("/connect")({
  component: ConnectRoute,
});
