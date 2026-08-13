import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

// TanStack Start's `beforeLoad` runs server-side (SSR, via Vercel's Nitro
// function) on a fresh navigation or full-page reload, and client-side (a
// real browser fetch, cookies attached automatically) on an in-app route
// transition. apps/web (vercel.app) and apps/api (railway.app) are
// different sites, so the session cookie is cross-site (SameSite=None,
// Partitioned — see packages/auth/src/config.ts's crossSiteCookies). On
// the server there is no browser cookie jar: the outgoing fetch to
// apps/api carries no cookie unless the incoming request's own Cookie
// header is forwarded explicitly. Without this, every cold navigation to
// an authenticated route looked signed-out (getSession() returned no
// data) even seconds after a real sign-in, because the SSR request never
// saw the browser's session cookie in the first place.
//
// createIsomorphicFn (not a plain `typeof window` check) is required
// here, not stylistic: the Start compiler rewrites this chain per-bundle,
// stripping the `@tanstack/react-start/server` import out of the client
// bundle entirely. A runtime-only guard still leaves that server-only
// import reachable from client code and fails the build outright
// (import-protection plugin), even though it would never execute.
// The .server() implementation itself is defensive (try/catch, not a bare
// call): the Start compiler's runtime fallback (used whenever this chain
// runs uncompiled — component/route unit tests included, per
// createIsomorphicFn's own doc comment) keeps the .server() implementation
// even when .client() is what should apply, since it can't tell it isn't
// running in the real server bundle. getRequestHeader needs an active H3
// request context that doesn't exist in a test run, and throwing there
// would break beforeLoad before it ever reaches its real redirect logic.
// Falling back to "no cookie forwarded" is the correct degrade anyway: it
// reproduces ordinary client fetch behavior, not a crash.
const getCookieHeader = createIsomorphicFn()
  .server(() => {
    try {
      return getRequestHeader("cookie");
    } catch {
      return undefined;
    }
  })
  .client(() => undefined);

export function serverAuthHeaders(): Record<string, string> | undefined {
  const cookie = getCookieHeader();
  return cookie ? { cookie } : undefined;
}
