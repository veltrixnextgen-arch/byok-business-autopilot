import { createFileRoute, redirect } from "@tanstack/react-router";
import { OnboardingScreen } from "../components/OnboardingScreen";
import { authClient } from "../lib/authClient";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) {
      throw redirect({ to: "/login" });
    }
    if (data.session.activeOrganizationId) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: OnboardingScreen,
});
