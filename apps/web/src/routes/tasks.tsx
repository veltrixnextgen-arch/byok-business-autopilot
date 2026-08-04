import { createFileRoute, redirect } from "@tanstack/react-router";
import { TaskListScreen } from "../components/TaskListScreen";
import { authClient } from "../lib/authClient";

export const Route = createFileRoute("/tasks")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) {
      throw redirect({ to: "/login" });
    }
  },
  component: TaskListScreen,
});
