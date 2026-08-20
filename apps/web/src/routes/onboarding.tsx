import { createFileRoute } from "@tanstack/react-router";
import { OnboardingScreen } from "../components/OnboardingScreen";
import { SessionCheckingScreen } from "../components/SessionCheckingScreen";
import { authClient } from "../lib/authClient";
import { resolveActiveOrganizationId } from "../lib/organizationClient";
import { type GuardRedirectTarget, useAuthGuard } from "../lib/useAuthGuard";

export async function checkAuth(): Promise<GuardRedirectTarget | null> {
  const { data } = await authClient.getSession();
  if (!data) return "/login";
  // Backstop, not just an optimization: a returning user's fresh
  // session has no active organization set (see organizationClient.ts)
  // even though they already own one — without this check they'd see
  // this screen's "name your company" form, which can only fail
  // ("Organization already exists") the moment they type their real
  // company name back in.
  if (data.session.activeOrganizationId || (await resolveActiveOrganizationId())) return "/dashboard";
  return null;
}

function OnboardingRoute() {
  const status = useAuthGuard(checkAuth);
  if (status !== "ready") return <SessionCheckingScreen />;
  return <OnboardingScreen />;
}

export const Route = createFileRoute("/onboarding")({
  component: OnboardingRoute,
});
