import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "../components/landing/ComingSoonPage";

export const Route = createFileRoute("/pricing")({
  component: Pricing,
});

function Pricing() {
  return <ComingSoonPage title="Pricing" />;
}
