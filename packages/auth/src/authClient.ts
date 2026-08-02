import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";

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
  });
}

export type BrowserAuthClient = ReturnType<typeof createBrowserAuthClient>;
