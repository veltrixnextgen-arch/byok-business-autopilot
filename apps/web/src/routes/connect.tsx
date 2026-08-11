import { createFileRoute, redirect } from "@tanstack/react-router";
import { ConnectScreen } from "../components/ConnectScreen";
import { authClient } from "../lib/authClient";

export const Route = createFileRoute("/connect")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) {
      throw redirect({ to: "/login" });
    }
    // A user with no organization yet has nowhere for tenantMiddleware to
    // scope /me/brain-key or /me/ceiling to — same gate dashboard.tsx uses.
    if (!data.session.activeOrganizationId) {
      throw redirect({ to: "/onboarding" });
    }
  },
  component: ConnectScreen,
});
