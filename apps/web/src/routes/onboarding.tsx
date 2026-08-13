import { createFileRoute, redirect } from "@tanstack/react-router";
import { OnboardingScreen } from "../components/OnboardingScreen";
import { authClient } from "../lib/authClient";
import { resolveActiveOrganizationId } from "../lib/organizationClient";
import { serverAuthHeaders } from "../lib/serverAuthHeaders";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async () => {
    const headers = serverAuthHeaders();
    const { data } = await authClient.getSession({ fetchOptions: { headers } });
    if (!data) {
      throw redirect({ to: "/login" });
    }
    // Backstop, not just an optimization: a returning user's fresh
    // session has no active organization set (see organizationClient.ts)
    // even though they already own one — without this check they'd see
    // this screen's "name your company" form, which can only fail
    // ("Organization already exists") the moment they type their real
    // company name back in.
    if (data.session.activeOrganizationId || (await resolveActiveOrganizationId(headers))) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: OnboardingScreen,
});
