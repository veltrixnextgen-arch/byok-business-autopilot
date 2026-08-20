import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

// Issue #118 workaround (see issue #119 for the real fix — a same-origin
// proxy). apps/web (vercel.app) and apps/api (railway.app) are different
// sites, so the session cookie is cross-site: SSR has no browser cookie
// jar to read it from, and every route's beforeLoad used to redirect a
// perfectly signed-in user to /login on a hard reload, bookmark, or deep
// link. Removing the server-side check isn't enough on its own, either:
// TanStack Start's client hydration trusts the server-rendered match and
// does not re-invoke beforeLoad for the route that was just SSR'd (only
// for a later in-app navigation — see @tanstack/router-core's
// ssr-client.js hydrate(), which skips router.load() whenever every
// match came from the server). So beforeLoad can never reliably gate
// these routes either way. This hook is the actual gate instead: a
// plain mount-time effect, which fires unconditionally whether the
// component just hydrated from SSR or was client-rendered by an in-app
// navigation — the one code path already proven to see the session
// cookie correctly (a real browser fetch, credentials included).
export type GuardRedirectTarget = "/login" | "/onboarding" | "/interview" | "/dashboard";

export type GuardStatus = "checking" | "ready";

export function useAuthGuard(check: () => Promise<GuardRedirectTarget | null>): GuardStatus {
  const navigate = useNavigate();
  const [status, setStatus] = useState<GuardStatus>("checking");
  // check() has real side effects (organization.setActive) — it must run
  // at most once per mount, not just render at most once. A ref (not
  // state) survives React StrictMode's dev-only mount/cleanup/remount
  // simulation, so the throwaway first pass is what actually runs
  // check(), and the real pass correctly no-ops instead of running it
  // twice.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    check()
      .then((redirectTo) => {
        if (redirectTo) {
          void navigate({ to: redirectTo });
          return; // stays "checking" — navigate() replaces this tree once it resolves
        }
        setStatus("ready");
      })
      .catch(() => void navigate({ to: "/login" }));
  }, [check, navigate]);

  return status;
}
