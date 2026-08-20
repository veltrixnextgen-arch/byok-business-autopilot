import { createFileRoute } from "@tanstack/react-router";
import { OrgChartScreen } from "../components/OrgChartScreen";
import { SessionCheckingScreen } from "../components/SessionCheckingScreen";
import { authClient } from "../lib/authClient";
import { type GuardRedirectTarget, useAuthGuard } from "../lib/useAuthGuard";

export async function checkAuth(): Promise<GuardRedirectTarget | null> {
  const { data } = await authClient.getSession();
  if (!data) return "/login";
  return null;
}

function OrgChartRoute() {
  const status = useAuthGuard(checkAuth);
  if (status !== "ready") return <SessionCheckingScreen />;
  return <OrgChartScreen />;
}

export const Route = createFileRoute("/org-chart")({
  component: OrgChartRoute,
});
