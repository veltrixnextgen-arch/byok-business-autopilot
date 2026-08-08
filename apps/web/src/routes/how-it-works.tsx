import { createFileRoute } from "@tanstack/react-router";
import { HowItWorksPage } from "../components/landing/HowItWorksPage";

export const Route = createFileRoute("/how-it-works")({
  component: HowItWorksPage,
});
