import { createFileRoute, redirect } from "@tanstack/react-router";
import { OrgChartScreen } from "../components/OrgChartScreen";
import { authClient } from "../lib/authClient";

export const Route = createFileRoute("/org-chart")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) {
      throw redirect({ to: "/login" });
    }
  },
  component: OrgChartScreen,
});
