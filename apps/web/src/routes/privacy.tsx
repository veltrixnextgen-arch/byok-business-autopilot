import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPolicyPage } from "../components/landing/PrivacyPolicyPage";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPolicyPage,
});
