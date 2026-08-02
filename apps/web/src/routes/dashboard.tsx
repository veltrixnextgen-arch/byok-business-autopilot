import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
// call). No product content; that starts at Step 5+.
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
    <main>
      <h1>Dashboard</h1>
      {error && <p role="alert">{error}</p>}
      {me ? (
        <dl>
          <dt>Signed in as</dt>
          <dd>{me.email}</dd>
          <dt>Tenant</dt>
          <dd>{me.tenantId}</dd>
        </dl>
      ) : (
        !error && <p>Loading…</p>
      )}
    </main>
  );
}
