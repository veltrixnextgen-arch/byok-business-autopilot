import { createFileRoute } from "@tanstack/react-router";
import { ByokExplainer } from "../components/landing/ByokExplainer";
import { ControlSafety } from "../components/landing/ControlSafety";
import { DashboardPreview } from "../components/landing/DashboardPreview";
import { FinalCta } from "../components/landing/FinalCta";
import { Hero } from "../components/landing/Hero";
import { InteractivePreview } from "../components/landing/InteractivePreview";
import { LandingFooter } from "../components/landing/LandingFooter";
import { LandingNav } from "../components/landing/LandingNav";
import { ProductStory } from "../components/landing/ProductStory";
import { ScrollSequence } from "../components/landing/ScrollSequence";
import { SpendingWalls } from "../components/landing/SpendingWalls";
import { ValueComparison } from "../components/landing/ValueComparison";

export const Route = createFileRoute("/")({
  component: Index,
});

// Rebuilt from the Emergent design reference (docs/design/reference-
// emergent.html, ADR-018) — supersedes the five-act LandingStory scroll.
// Every section here is marketing surface: the idea box (Hero, FinalCta)
// is the only thing that actually does anything. Control & safety,
// spending walls, BYOK, and the dashboard preview all depict product
// surfaces that don't exist in apps/web yet (same disclosed-illustrative
// convention as reference.html's own non-built screen tabs) — nothing
// downstream of this route changed: same submit handler, same funnel
// events, same sessionStorage hand-off, same routing (PR #62/#64,
// verified live).
export function Index() {
  return (
    <>
      <LandingNav />
      <Hero />
      <ScrollSequence />
      <ProductStory />
      <InteractivePreview />
      <ControlSafety />
      <SpendingWalls />
      <ByokExplainer />
      <DashboardPreview />
      <ValueComparison />
      <FinalCta />
      <LandingFooter />
    </>
  );
}
