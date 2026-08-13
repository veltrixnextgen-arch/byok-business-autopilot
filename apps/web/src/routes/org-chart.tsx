import { createFileRoute, redirect } from "@tanstack/react-router";
import { OrgChartScreen } from "../components/OrgChartScreen";
import { authClient } from "../lib/authClient";
import { serverAuthHeaders } from "../lib/serverAuthHeaders";

export const Route = createFileRoute("/org-chart")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession({ fetchOptions: { headers: serverAuthHeaders() } });
    if (!data) {
      throw redirect({ to: "/login" });
    }
  },
  component: OrgChartScreen,
});
