import { serve } from "@hono/node-server";
import { createAuth } from "@byok/auth";
import { createDb, createPool, SignupExtractionBatchStore, SignupMetricsStore } from "@byok/db";
import type { TrustCoreDeps } from "./context.js";
import { createApp } from "./index.js";

export interface ServerConfig {
  port: number;
  databaseUrl: string;
  authSecret: string;
  authBaseUrl: string;
  webOrigin: string;
  /** See AuthConfigOptions.crossSiteCookies — off by default because
   *  SameSite=None requires Secure (HTTPS), which local dev's
   *  http://localhost can't satisfy. Explicit opt-in via env var. */
  crossSiteCookies: boolean;
  /** Onboarding-only platform inference key (ADR-003) — pays for the
   *  capped extraction/chart/simulated-day/Charter-draft batch and
   *  nothing else. Required, same discipline as DATABASE_URL: a server
   *  that can't run the one thing it's the platform's job to pay for
   *  should fail at startup, not on the first signup. */
  anthropicApiKey: string;
  /** Gates GET /internal/metrics (Phase B Step 6C) — a platform
   *  credential the founder holds, not a user credential, same
   *  discipline as anthropicApiKey: a server that can't gate this route
   *  should fail at startup, not serve it unprotected on the first
   *  request. */
  internalMetricsToken: string;
  /** Google Calendar Hands OAuth (PR 2B, ADR-021). Deliberately NOT
   *  required like anthropicApiKey/internalMetricsToken above — this is a
   *  platform app registration (client id/secret, ADR-003's "platform
   *  secrets live in env config, never the vault" pattern extended to a
   *  second use), and it genuinely doesn't exist yet: Google's app
   *  verification needs a real public domain and privacy policy this
   *  product doesn't have yet either. null means "the feature is wired
   *  and code-complete but inert" — /me/hands-oauth/google-calendar/start
   *  404s cleanly instead of the whole server refusing to boot. Setting
   *  these two env vars in a real deployment is the ONLY remaining step
   *  once real credentials exist — no code changes required. */
  google: { clientId: string; clientSecret: string; redirectUri: string } | null;
}

export function readServerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const databaseUrl = env.DATABASE_URL;
  const authSecret = env.BETTER_AUTH_SECRET;
  const anthropicApiKey = env.ANTHROPIC_API_KEY;
  const internalMetricsToken = env.INTERNAL_METRICS_TOKEN;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!authSecret) throw new Error("BETTER_AUTH_SECRET is required");
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required");
  if (!internalMetricsToken) throw new Error("INTERNAL_METRICS_TOKEN is required");

  const port = Number(env.PORT ?? 3000);
  const authBaseUrl = env.BETTER_AUTH_URL ?? `http://localhost:${port}`;
  const webOrigin = env.WEB_ORIGIN ?? "http://localhost:3002";
  const crossSiteCookies = env.CROSS_SITE_COOKIES === "true";

  const googleClientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const google =
    googleClientId && googleClientSecret
      ? { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: `${authBaseUrl}/hands-oauth/google-calendar/callback` }
      : null;

  return { port, databaseUrl, authSecret, authBaseUrl, webOrigin, crossSiteCookies, anthropicApiKey, internalMetricsToken, google };
}

/**
 * Trust-core (Router/CostGate/ApprovalQueue/Vault) construction is
 * deliberately NOT done here: the pricing table source, ceiling amounts,
 * and KMS choice are real financial/security-safety decisions this shell
 * has no basis to invent on its own, and belong with whoever owns
 * deployment config (tied to the cost dashboard work). Pass a real
 * TrustCoreDeps in from that bootstrap.
 *
 * `pool` is likewise accepted rather than built here: trust-core's own
 * bootstrap (createDevTrustCore) now needs the SAME pool to back its
 * per-tenant ceiling resolver (issue #15), and constructing two separate
 * Pool instances against the same database would be wasteful and
 * confusing. The caller builds one pool via @byok/db's createPool and
 * passes it to both.
 */
export function startServer(config: ServerConfig, trustCore: TrustCoreDeps, pool: ReturnType<typeof createPool>) {
  const db = createDb(pool);
  const auth = createAuth({
    db,
    pool,
    baseURL: config.authBaseUrl,
    secret: config.authSecret,
    trustedOrigins: [config.webOrigin],
    crossSiteCookies: config.crossSiteCookies,
  });
  const batchStore = new SignupExtractionBatchStore(pool);
  const metricsStore = new SignupMetricsStore(pool);
  const app = createApp({
    pool,
    auth,
    trustCore,
    webOrigin: config.webOrigin,
    extraction: { batchStore, apiKey: config.anthropicApiKey },
    metrics: { metricsStore, internalMetricsToken: config.internalMetricsToken },
    // Reuses authSecret for state-token signing (ADR-021) — see
    // oauth/state.ts's own comment on why a second required secret isn't
    // needed for this.
    handsOAuth: { stateSecret: config.authSecret, google: config.google },
  });

  return serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`@byok/api listening on http://localhost:${info.port}`);
    console.log(`crossSiteCookies=${config.crossSiteCookies} authBaseUrl=${config.authBaseUrl} webOrigin=${config.webOrigin}`);
  });
}
