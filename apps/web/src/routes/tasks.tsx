import { createFileRoute } from "@tanstack/react-router";
import { SessionCheckingScreen } from "../components/SessionCheckingScreen";
import { TaskListScreen } from "../components/TaskListScreen";
import { authClient } from "../lib/authClient";
import { type GuardRedirectTarget, useAuthGuard } from "../lib/useAuthGuard";

export async function checkAuth(): Promise<GuardRedirectTarget | null> {
  const { data } = await authClient.getSession();
  if (!data) return "/login";
  return null;
}

function TasksRoute() {
  const status = useAuthGuard(checkAuth);
  if (status !== "ready") return <SessionCheckingScreen />;
  return <TaskListScreen />;
}

export const Route = createFileRoute("/tasks")({
  component: TasksRoute,
});
