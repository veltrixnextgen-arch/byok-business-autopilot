import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "../components/landing/ComingSoonPage";

export const Route = createFileRoute("/how-it-works")({
  component: HowItWorks,
});

function HowItWorks() {
  return <ComingSoonPage title="How It Works" />;
}
