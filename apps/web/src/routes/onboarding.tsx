import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button, TextInput } from "../components/ui";
import { authClient } from "../lib/authClient";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) {
      throw redirect({ to: "/login" });
    }
    if (data.session.activeOrganizationId) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: Onboarding,
});

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
function Onboarding() {
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

    await navigate({ to: "/dashboard" });
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
