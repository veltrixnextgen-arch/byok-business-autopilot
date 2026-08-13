import { createFileRoute, redirect } from "@tanstack/react-router";
import { InterviewScreen } from "../components/InterviewScreen";
import { authClient } from "../lib/authClient";
import { serverAuthHeaders } from "../lib/serverAuthHeaders";

export const Route = createFileRoute("/interview")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession({ fetchOptions: { headers: serverAuthHeaders() } });
    if (!data) {
      throw redirect({ to: "/login" });
    }
  },
  component: InterviewScreen,
});
