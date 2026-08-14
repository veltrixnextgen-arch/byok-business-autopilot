import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient } from "../lib/authClient";
import { claimOrgChart, loadIdea } from "../lib/extractionClient";
import { Button, TextInput } from "./ui";

// Split out of routes/onboarding.tsx (a plain export here, so it's
// directly testable) — same reason as InterviewScreen/SignupScreen:
// TanStack Start's route-file compiler only lazy-splits a route's local
// `component`, and stops doing so the moment that same symbol is also
// exported for anything else.

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

// Minimal by design (Phase B Step 3): name the company, create the org,
// land in it. No invites, no roles, no settings UI — those are later
// steps. The real interview-driven onboarding is ADR-011/Step 4's job;
// this exists only to unblock the gap Step 2 flagged (a signed-up user
// had no way to ever get a tenant).
export function OnboardingScreen() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const slug = slugify(name);
    if (!slug) {
      setError("Give your company a name with at least one letter or number.");
      return;
    }

    setSubmitting(true);
    const { data, error: createError } = await authClient.organization.create({ name, slug });
    if (createError || !data) {
      setSubmitting(false);
      setError(createError?.message ?? "Could not create your company — try a different name.");
      return;
    }

    const { error: activeError } = await authClient.organization.setActive({ organizationId: data.id });
    setSubmitting(false);
    if (activeError) {
      setError(activeError.message ?? "Created, but could not switch you into it — try signing in again.");
      return;
    }

    // Issue #38: the org-chart -> tenant handoff (ADR-015's deferred gap),
    // triggered at the earliest point a tenant exists today. Best-effort
    // and non-blocking — a user who hasn't finished the interview yet has
    // nothing to claim, and that's a normal, not-an-error state; either
    // way the user should still land in the app, not get stuck here.
    claimOrgChart().catch(() => {});

    // A signed-up user can reach org creation with a pending idea still
    // sitting in sessionStorage (e.g. they weren't sent straight to
    // /interview after signup for whatever reason, and /dashboard's own
    // beforeLoad bounced them here for lacking an org). Whatever the
    // path, don't drop the idea on the floor a second time — carry it
    // the rest of the way instead of skipping straight past the Charter.
    //
    // R2/ADR-024: when there's no pending idea, a completed org chart was
    // just claimed above — send the user to review and hand off its
    // Charter (master-plan-v2.md Stage 4) instead of straight to the
    // still-placeholder dashboard. CharterScreen itself navigates to
    // /dashboard once the handoff completes.
    await navigate({ to: loadIdea() ? "/interview" : "/charter" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div className="space-y-2 duration-ceremony-base ease-ceremony">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Step 1</p>
        <h1 className="font-display text-3xl font-semibold">Name your company.</h1>
        <p className="text-text-secondary">This becomes your workspace. You can change it later.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Studio" required autoFocus />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Creating…" : "Create company"}
        </Button>
      </form>
    </main>
  );
}
