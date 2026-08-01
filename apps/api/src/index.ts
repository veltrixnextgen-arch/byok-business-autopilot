import type { Auth } from "@byok/auth";
import type { PoolLike } from "@byok/db";
import { Hono } from "hono";
import type { AppEnv, TrustCoreDeps } from "./context.js";
import { requireStepUp } from "./middleware/stepUp.js";
import { tenantMiddleware } from "./middleware/tenant.js";
import { healthRoute } from "./routes/health.js";
import { tasksRoute } from "./routes/tasks.js";

export interface CreateAppOptions {
  pool: PoolLike;
  auth: Auth;
  trustCore: TrustCoreDeps;
}

/**
 * Route composition keeps Hono's method-chaining type inference intact so
 * `AppType` below can drive a fully typed `hc<AppType>()` client on the
 * (future) apps/web side — the "typed API boundary" the shell spec calls
 * for, without introducing a separate RPC layer.
 */
export function createApp(options: CreateAppOptions) {
  const app = new Hono<AppEnv>()
    .route("/health", healthRoute)
    .all("/auth/*", (c) => options.auth.handler(c.req.raw))
    .use("/tasks/*", tenantMiddleware(options.pool, options.auth))
    .route("/tasks", tasksRoute(options.trustCore));

  return app;
}

export type AppType = ReturnType<typeof createApp>;

export { requireStepUp, tenantMiddleware };
export type { AppEnv, AppSession, TrustCoreDeps } from "./context.js";
