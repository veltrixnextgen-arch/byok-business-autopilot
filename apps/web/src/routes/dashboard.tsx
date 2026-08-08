import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "../components/ui";
import { apiClient } from "../lib/apiClient";
import { authClient } from "../lib/authClient";
import { getLatestBatch, loadIdea, type LatestBatch } from "../lib/extractionClient";

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
    // A pending idea means the interview was never finished — whatever
    // path landed the user here (direct URL, back button, a future code
    // path that misses one of the signup/org-creation hand-offs), this
    // is the backstop that keeps them from being parked on a dashboard
    // that has nothing to show yet. Cleared by InterviewScreen once
    // extraction actually completes, so a returning user with a real org
    // chart never gets bounced back in here.
    if (loadIdea()) {
      throw redirect({ to: "/interview" });
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
  const [batch, setBatch] = useState<LatestBatch | null>(null);

  useEffect(() => {
    // DIAGNOSTIC (temporary — remove once the /me-never-dispatches
    // investigation is resolved, see verify-staging-styled.mjs's matching
    // note): traces effect entry, the call itself, and both outcomes, so
    // the deploy pipeline's own console-capturing instrumentation can show
    // what actually happens for a real authenticated session.
    console.log("[dashboard] effect running, about to call apiClient.me.$get()");
    let request;
    try {
      request = apiClient.me.$get();
      console.log("[dashboard] apiClient.me.$get() returned, awaiting response");
    } catch (err) {
      console.log("[dashboard] apiClient.me.$get() threw synchronously:", String(err));
      setError(String(err));
      request = undefined;
    }
    request
      ?.then(async (res) => {
        console.log(`[dashboard] /me responded: ${res.status}`);
        if (!res.ok) {
          setError(`API returned ${res.status}`);
          return;
        }
        setMe(await res.json());
      })
      .catch((err: unknown) => {
        console.log("[dashboard] /me promise rejected:", String(err));
        setError(String(err));
      });
    // Fire-and-forget, same spirit as recordFunnelEvent — a returning
    // user's "back into your org chart" link is a nice-to-have, not
    // something worth blocking or erroring the dashboard over.
    getLatestBatch()
      .then(setBatch)
      .catch(() => {});
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
      {batch?.status === "completed" && (
        <Link
          to="/org-chart"
          className="text-center font-medium text-accent transition-colors duration-calm-fast ease-calm hover:text-accent-strong"
        >
          View your org chart →
        </Link>
      )}
    </main>
  );
}
