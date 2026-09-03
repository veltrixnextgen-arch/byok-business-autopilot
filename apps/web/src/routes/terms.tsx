import { createFileRoute } from "@tanstack/react-router";
import { TermsOfServicePage } from "../components/landing/TermsOfServicePage";

export const Route = createFileRoute("/terms")({
  component: TermsOfServicePage,
});
