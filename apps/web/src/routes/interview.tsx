import { createFileRoute } from "@tanstack/react-router";
import { InterviewScreen } from "../components/InterviewScreen";
import { SessionCheckingScreen } from "../components/SessionCheckingScreen";
import { authClient } from "../lib/authClient";
import { type GuardRedirectTarget, useAuthGuard } from "../lib/useAuthGuard";

export async function checkAuth(): Promise<GuardRedirectTarget | null> {
  const { data } = await authClient.getSession();
  if (!data) return "/login";
  return null;
}

function InterviewRoute() {
  const status = useAuthGuard(checkAuth);
  if (status !== "ready") return <SessionCheckingScreen />;
  return <InterviewScreen />;
}

export const Route = createFileRoute("/interview")({
  component: InterviewRoute,
});
