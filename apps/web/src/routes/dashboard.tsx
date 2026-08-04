import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "../components/ui";
import { apiClient } from "../lib/apiClient";
import { authClient } from "../lib/authClient";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) {
      throw redirect({ to: "/login" });
    }
    // A signed-up user with no organization yet has nowhere for
    // tenantMiddleware to scope them to — send them to create one instead
    // of rendering a dashboard that can only ever show a 401.
    if (!data.session.activeOrganizationId) {
      throw redirect({ to: "/onboarding" });
    }
  },
  component: Dashboard,
});

interface Me {
  userId: string;
  email: string;
  tenantId: string;
}

// Foundation only — this route's entire job is to prove auth + tenant +
// API work end to end (session -> tenantMiddleware -> RLS-scoped /me
// call). No product content; that starts at Step 5+. Styled just enough
// to not look broken (STEP 7 auth-pages pass) — the real dashboard is a
// later step, not this one.
function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.me
      .$get()
      .then(async (res) => {
        if (!res.ok) {
          setError(`API returned ${res.status}`);
          return;
        }
        setMe(await res.json());
      })
      .catch((err: unknown) => setError(String(err)));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Dashboard</h1>
      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {me ? (
        <Card>
          <dl className="space-y-3 font-mono text-sm">
            <div>
              <dt className="text-text-muted">Signed in as</dt>
              <dd className="text-text">{me.email}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Tenant</dt>
              <dd className="text-text">{me.tenantId}</dd>
            </div>
          </dl>
        </Card>
      ) : (
        !error && <p className="text-text-muted">Loading…</p>
      )}
    </main>
  );
}
