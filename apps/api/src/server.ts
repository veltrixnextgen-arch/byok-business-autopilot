import { serve } from "@hono/node-server";
import { createAuth } from "@byok/auth";
import { createDb, createPool, SignupExtractionBatchStore } from "@byok/db";
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
}

export function readServerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const databaseUrl = env.DATABASE_URL;
  const authSecret = env.BETTER_AUTH_SECRET;
  const anthropicApiKey = env.ANTHROPIC_API_KEY;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!authSecret) throw new Error("BETTER_AUTH_SECRET is required");
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const port = Number(env.PORT ?? 3000);
  const authBaseUrl = env.BETTER_AUTH_URL ?? `http://localhost:${port}`;
  const webOrigin = env.WEB_ORIGIN ?? "http://localhost:3002";
  const crossSiteCookies = env.CROSS_SITE_COOKIES === "true";
  return { port, databaseUrl, authSecret, authBaseUrl, webOrigin, crossSiteCookies, anthropicApiKey };
}

/**
 * Trust-core (Router/CostGate/ApprovalQueue) construction is deliberately
 * NOT done here: the pricing table source and ceiling amounts are real
 * financial-safety decisions this shell has no basis to invent on its own,
 * and belong with whoever owns deployment config (tied to the cost
 * dashboard work). Pass a real TrustCoreDeps in from that bootstrap.
 */
export function startServer(config: ServerConfig, trustCore: TrustCoreDeps) {
  const pool = createPool({ connectionString: config.databaseUrl });
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
  const app = createApp({
    pool,
    auth,
    trustCore,
    webOrigin: config.webOrigin,
    extraction: { batchStore, apiKey: config.anthropicApiKey },
  });

  return serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`@byok/api listening on http://localhost:${info.port}`);
    console.log(`crossSiteCookies=${config.crossSiteCookies} authBaseUrl=${config.authBaseUrl} webOrigin=${config.webOrigin}`);
  });
}
