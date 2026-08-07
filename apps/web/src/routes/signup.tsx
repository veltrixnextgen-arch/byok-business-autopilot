import { createFileRoute } from "@tanstack/react-router";
import { SignupScreen } from "../components/SignupScreen";

export const Route = createFileRoute("/signup")({
  component: SignupScreen,
});
