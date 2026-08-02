import { serve } from "@hono/node-server";
import { createAuth } from "@byok/auth";
import { createDb, createPool } from "@byok/db";
import type { TrustCoreDeps } from "./context.js";
import { createApp } from "./index.js";

export interface ServerConfig {
  port: number;
  databaseUrl: string;
  authSecret: string;
  authBaseUrl: string;
  webOrigin: string;
}

export function readServerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const databaseUrl = env.DATABASE_URL;
  const authSecret = env.BETTER_AUTH_SECRET;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!authSecret) throw new Error("BETTER_AUTH_SECRET is required");

  const port = Number(env.PORT ?? 3000);
  const authBaseUrl = env.BETTER_AUTH_URL ?? `http://localhost:${port}`;
  const webOrigin = env.WEB_ORIGIN ?? "http://localhost:3002";
  return { port, databaseUrl, authSecret, authBaseUrl, webOrigin };
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
    baseURL: config.authBaseUrl,
    secret: config.authSecret,
    trustedOrigins: [config.webOrigin],
  });
  const app = createApp({ pool, auth, trustCore, webOrigin: config.webOrigin });

  return serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`@byok/api listening on http://localhost:${info.port}`);
  });
}
