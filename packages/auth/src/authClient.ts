import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";

// Shared with apps/web/src/lib/apiClient.ts's directApiClient, which reads
// this same key to attach `Authorization: Bearer <token>` on its
// cross-origin calls — see config.ts's `bearer()` plugin comment for why
// that's needed at all (the session cookie is a third-party cookie on
// those calls, which SameSite=None doesn't make browsers actually send).
// sessionStorage, not localStorage: this token is a fallback for one
// tab's direct-to-Railway calls, not the primary session (the cookie
// still is, for every same-origin call) — no need for it to outlive the
// tab, and IDEA_KEY (extractionClient.ts) already established this
// codebase's own preference for tab-scoped, not cross-tab, client state.
export const CROSS_ORIGIN_AUTH_TOKEN_KEY = "byok:bearer-token";

/**
 * Browser-side counterpart to config.ts's createAuth() — same plugin set
 * (organization = tenant, twoFactor = MFA) so client and server never
 * drift out of sync. Deliberately its OWN subpath export
 * (`@byok/auth/client`, not the package root `@byok/auth`) so apps/api
 * (Node, no React) never pulls in a React dependency just because it
 * imports @byok/auth for the server config.
 */
export interface BrowserAuthClientOptions {
  baseURL: string;
}

export function createBrowserAuthClient(options: BrowserAuthClientOptions) {
  return createAuthClient({
    baseURL: options.baseURL,
    plugins: [organizationClient(), twoFactorClient()],
    // Captures the bearer plugin's own `set-auth-token` response header on
    // every same-origin auth call (sign-in, sign-up, and any session
    // refresh) — this call goes through the cookie-based, same-origin path
    // (this client's own baseURL), so it always succeeds regardless of
    // third-party cookie policy; it's just also the one place a fresh
    // token is available to capture for the OTHER, cross-origin path.
    fetchOptions: {
      onResponse: (context) => {
        if (typeof window === "undefined") return;
        const token = context.response.headers.get("set-auth-token");
        if (token) sessionStorage.setItem(CROSS_ORIGIN_AUTH_TOKEN_KEY, token);
      },
    },
  });
}

export type BrowserAuthClient = ReturnType<typeof createBrowserAuthClient>;
