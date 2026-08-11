import type { Auth } from "@byok/auth";
import type { PoolLike, SignupExtractionBatchStore, SignupMetricsStore } from "@byok/db";
import { PostgresCostActivityQueries } from "@byok/router";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv, TrustCoreDeps } from "./context.js";
import { requireStepUp } from "./middleware/stepUp.js";
import { tenantMiddleware } from "./middleware/tenant.js";
import { userMiddleware } from "./middleware/user.js";
import { dashboardRoute } from "./routes/dashboard.js";
import { extractionRoute } from "./routes/extraction.js";
import { healthRoute } from "./routes/health.js";
import { internalMetricsRoute } from "./routes/internalMetrics.js";
import { meRoute } from "./routes/me.js";
import { signupMetricsRoute } from "./routes/signupMetrics.js";
import { tasksRoute } from "./routes/tasks.js";

export interface CreateAppOptions {
  pool: PoolLike;
  auth: Auth;
  trustCore: TrustCoreDeps;
  /** apps/web's own origin (e.g. http://localhost:3002 in dev) — needed
   *  because they run on different ports/domains, and the session cookie
   *  Better Auth sets only gets sent cross-origin if CORS explicitly
   *  allows this exact origin with credentials. */
  webOrigin: string;
  /** The idea -> interview -> extraction -> org-chart flow (ADR-014,
   *  ADR-015) — separate from trustCore because it's user-scoped, not
   *  tenant-scoped, and needs its own store plus the platform's onboarding
   *  key (ADR-003), neither of which the rest of trustCore needs. */
  extraction: {
    batchStore: SignupExtractionBatchStore;
    apiKey: string;
  };
  /** MVP-0 tester gate (Phase B Step 6C) — the write side (funnel events,
   *  feedback) is user-scoped like extraction; the read side
   *  (internalMetrics) is a separate, token-gated operator view. */
  metrics: {
    metricsStore: SignupMetricsStore;
    internalMetricsToken: string;
  };
}

/**
 * Route composition keeps Hono's method-chaining type inference intact so
 * `AppType` below can drive a fully typed `hc<AppType>()` client on
 * apps/web — the "typed API boundary" the shell spec calls for, without
 * introducing a separate RPC layer. The chain must stay static (no
 * conditional reassignment) for that inference to hold.
 */
export function createApp(options: CreateAppOptions) {
  // Pure read wrapper over the pool — no state, safe to build once here
  // rather than threading a new required CreateAppOptions field through
  // every existing caller for a single read-only route.
  const costActivity = new PostgresCostActivityQueries(options.pool);

  const app = new Hono<AppEnv>()
    .use("*", cors({ origin: options.webOrigin, credentials: true }))
    .route("/health", healthRoute)
    // Better Auth's default basePath is /api/auth on both server and
    // client (createBrowserAuthClient doesn't override it) — this mount
    // must match, or the client's requests never reach a route Better
    // Auth's own handler recognizes (a bare /auth/* mount 404s on every
    // call, discovered only once a real signup was attempted here).
    .all("/api/auth/*", (c) => options.auth.handler(c.req.raw))
    .use("/me/*", tenantMiddleware(options.pool, options.auth))
    .route("/me", meRoute({ batchStore: options.extraction.batchStore }))
    .use("/dashboard/*", tenantMiddleware(options.pool, options.auth))
    .route("/dashboard", dashboardRoute({ costActivity }))
    .use("/tasks/*", tenantMiddleware(options.pool, options.auth))
    .route("/tasks", tasksRoute(options.trustCore))
    .use("/extraction/*", userMiddleware(options.auth))
    .route(
      "/extraction",
      extractionRoute({
        batchStore: options.extraction.batchStore,
        costGate: options.trustCore.costGate,
        ledger: options.trustCore.ledger,
        apiKey: options.extraction.apiKey,
      }),
    )
    .use("/metrics/*", userMiddleware(options.auth))
    .route("/metrics", signupMetricsRoute(options.metrics.metricsStore))
    // Deliberately NOT userMiddleware — this is an operator view across
    // every signup, gated by its own token instead (see internalMetrics.ts).
    .route(
      "/internal/metrics",
      internalMetricsRoute({
        pool: options.pool,
        metricsStore: options.metrics.metricsStore,
        batchStore: options.extraction.batchStore,
        token: options.metrics.internalMetricsToken,
      }),
    );

  return app;
}

export type AppType = ReturnType<typeof createApp>;

export { requireStepUp, tenantMiddleware, userMiddleware };
export type { AppEnv, AppSession, TrustCoreDeps } from "./context.js";
