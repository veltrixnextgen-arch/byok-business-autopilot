import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

// Foundation only — the real idea-box onboarding landing page is a later
// step (Step 4, per ADR-011's interview design). This just proves the
// route tree, layout, and auth links resolve.
function Index() {
  return (
    <main>
      <h1>BYOK Business Autopilot</h1>
      <p>Frontend foundation scaffold. Onboarding lands here in a later step.</p>
      <nav>
        <Link to="/login">Sign in</Link> · <Link to="/signup">Sign up</Link>
      </nav>
    </main>
  );
}
