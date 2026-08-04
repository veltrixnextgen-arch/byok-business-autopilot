import { createFileRoute, redirect } from "@tanstack/react-router";
import { InterviewScreen } from "../components/InterviewScreen";
import { authClient } from "../lib/authClient";

export const Route = createFileRoute("/interview")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) {
      throw redirect({ to: "/login" });
    }
  },
  component: InterviewScreen,
});
