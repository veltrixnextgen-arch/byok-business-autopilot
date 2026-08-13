import { createFileRoute, redirect } from "@tanstack/react-router";
import { DashboardScreen } from "../components/DashboardScreen";
import { authClient } from "../lib/authClient";
import { loadIdea } from "../lib/extractionClient";
import { resolveActiveOrganizationId } from "../lib/organizationClient";
import { serverAuthHeaders } from "../lib/serverAuthHeaders";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const headers = serverAuthHeaders();
    const { data } = await authClient.getSession({ fetchOptions: { headers } });
    if (!data) {
      throw redirect({ to: "/login" });
    }
    // A signed-up user with no organization yet has nowhere for
    // tenantMiddleware to scope them to — send them to create one instead
    // of rendering a dashboard that can only ever show a 401. A null
    // activeOrganizationId doesn't necessarily mean "no organization" —
    // it means "not active on THIS session" (see organizationClient.ts) —
    // so check for a real one before concluding onboarding is needed.
    const activeOrganizationId = data.session.activeOrganizationId ?? (await resolveActiveOrganizationId(headers));
    if (!activeOrganizationId) {
      throw redirect({ to: "/onboarding" });
    }
    // A pending idea means the interview was never finished — whatever
    // path landed the user here (direct URL, back button, a future code
    // path that misses one of the signup/org-creation hand-offs), this
    // is the backstop that keeps them from being parked on a dashboard
    // that has nothing to show yet. Cleared by InterviewScreen once
    // extraction actually completes, so a returning user with a real org
    // chart never gets bounced back in here.
    if (loadIdea()) {
      throw redirect({ to: "/interview" });
    }
  },
  component: DashboardScreen,
});
