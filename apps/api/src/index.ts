import type { Auth } from "@byok/auth";
import { PostgresDurableBatchStore } from "@byok/cost-gate";
import {
  CompanyCharterStore,
  SchedulerInstrumentationStore,
  TenantCeilingStore,
  TenantScheduleStateStore,
  getTenantTier,
  setTenantStripeIds,
  setTenantTier,
  type PoolLike,
  type SignupExtractionBatchStore,
  type SignupMetricsStore,
  type TemplateTaskDeltaStore,
} from "@byok/db";
import { syncTenantSchedule, type ConnectionHealth, type QueueLike, type RepeatableQueueLike } from "@byok/jobs";
import { PostgresCostActivityQueries } from "@byok/router";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { StripeClient } from "./billing/stripeClient.js";
import type { AppEnv, TrustCoreDeps } from "./context.js";
import type { DigestDeps } from "./digest/buildDigestData.js";
import type { ScheduleNotificationDeps } from "./scheduler/scheduleNotifications.js";
import { requireStepUp } from "./middleware/stepUp.js";
import { tenantMiddleware } from "./middleware/tenant.js";
import { userMiddleware } from "./middleware/user.js";
import { approvalsRoute } from "./routes/approvals.js";
import { billingCheckoutRoute, billingWebhookRoute } from "./routes/billing.js";
import { brainKeyRoute } from "./routes/brainKeys.js";
import { ceilingRoute } from "./routes/ceiling.js";
import { charterRoute } from "./routes/charter.js";
import { dashboardRoute } from "./routes/dashboard.js";
import { digestRoute } from "./routes/digest.js";
import { extractionRoute } from "./routes/extraction.js";
import { handsKeyRoute } from "./routes/handsKeys.js";
import { handsOAuthRoute, type HandsOAuthRouteDeps } from "./routes/handsOAuth.js";
import { healthRoute } from "./routes/health.js";
import { internalMetricsRoute } from "./routes/internalMetrics.js";
import { internalSchedulerDebugRoute } from "./routes/internalSchedulerDebug.js";
import { meRoute } from "./routes/me.js";
import { schedulerRoute } from "./routes/scheduler.js";
import { signupMetricsRoute } from "./routes/signupMetrics.js";
import { tasksRoute } from "./routes/tasks.js";
import { tierRoute } from "./routes/tier.js";
import { applyTierChange } from "./scheduler/applyTierChange.js";
import { computeDesiredSchedule, type ScheduledDispatchPayload } from "./scheduler/computeDesiredSchedule.js";

export interface CreateAppOptions {
  pool: PoolLike;
  auth: Auth;
  trustCore: TrustCoreDeps;
  /** apps/web's own canonical origin (e.g. http://localhost:3002 in dev) —
   *  used for building redirect/callback URLs. See webOrigins below for
   *  what CORS itself actually checks against. */
  webOrigin: string;
  /** Every trusted web origin CORS should accept — see ServerConfig's own
   *  doc comment (server.ts) for why this can't just be webOrigin: a
   *  browser sends whichever origin the user actually typed (e.g.
   *  www.runwisely.cc vs. runwisely.cc), and the session cookie Better
   *  Auth sets only gets sent cross-origin if CORS explicitly allows that
   *  exact origin with credentials. */
  webOrigins: string[];
  /** The idea -> interview -> extraction -> org-chart flow (ADR-014,
   *  ADR-015) — separate from trustCore because it's user-scoped, not
   *  tenant-scoped, and needs its own store plus the platform's onboarding
   *  key (ADR-003), neither of which the rest of trustCore needs. */
  extraction: {
    batchStore: SignupExtractionBatchStore;
    taskDeltaStore: TemplateTaskDeltaStore;
    apiKey: string;
  };
  /** MVP-0 tester gate (Phase B Step 6C) — the write side (funnel events,
   *  feedback) is user-scoped like extraction; the read side
   *  (internalMetrics) is a separate, token-gated operator view. */
  metrics: {
    metricsStore: SignupMetricsStore;
    internalMetricsToken: string;
  };
  /** Hands OAuth connect (PR 2B) — kept separate from trustCore.vault
   *  (which handsOAuthRoute also needs) because stateSecret/google are
   *  route-composition config, not trust-core custody. */
  handsOAuth: Pick<HandsOAuthRouteDeps, "stateSecret" | "google">;
  /** R3/ADR-025: the scheduler's own repeatable-job registry (BullMQ,
   *  packages/jobs) — a real Redis-backed resource constructed once at
   *  server bootstrap (start.ts/dev.ts), not something safe to build
   *  inline here the way a thin Postgres-pool wrapper is. `jobName` is the
   *  BullMQ job/queue name the scheduled-dispatch worker (also constructed
   *  at bootstrap) listens on — both sides must agree on it. */
  scheduler: {
    // Issue #159: widened to also include .add() (a real BullMQ Queue
    // satisfies both — see scheduler.ts's own comment on this exact type).
    queue: RepeatableQueueLike & QueueLike<ScheduledDispatchPayload>;
    jobName: string;
    /** Live status of the Queue's and Worker's own Redis connections
     *  (packages/jobs's trackConnectionHealth) — surfaced via /health and
     *  /internal/scheduler-debug so a stuck-forever connection (BullMQ's
     *  own bootstrap has no timeout of its own) is visible immediately
     *  instead of silently reported as "ok". */
    health: { queue: ConnectionHealth; worker: ConnectionHealth };
    /** Issue #140: /me/scheduler's own status/resume routes need the same
     *  notification deps the dispatch processor uses (constructed once in
     *  server.ts, threaded through both places) so "what it costs to
     *  resume" and the resume email use one consistent source of truth. */
    notifications: ScheduleNotificationDeps;
  };
  /** R4: GET /me/digest reuses the exact same aggregation deps the
   *  scheduled daily-digest email job uses (server.ts's digestDeps) —
   *  one source of truth for "today's digest," not a second one. */
  digest: DigestDeps;
  /** Issue #18/ADR-045: Stripe billing. `null` whenever no live Stripe
   *  account is configured yet (no STRIPE_SECRET_KEY/price ids) — see
   *  server.ts's readServerConfigFromEnv and routes/billing.ts's own
   *  comment on why this is a runtime null-check inside the route
   *  rather than the route being conditionally mounted. */
  billing: { stripe: StripeClient } | null;
  /** ADR-029: self-reported build identity, surfaced on /health. See
   *  routes/health.ts's own doc comment. */
  buildSha: string;
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
  // Same reasoning as costActivity above — a thin pool wrapper (issue #15),
  // safe to construct here rather than adding a CreateAppOptions field.
  const ceilings = new TenantCeilingStore(options.pool);
  // Same reasoning again (R2/ADR-024) — CompanyCharterStore is a thin
  // withTenantScope wrapper with no state of its own.
  const charters = new CompanyCharterStore(options.pool);
  // Same reasoning again (R3/ADR-025) — thin withTenantScope wrappers,
  // no state of their own beyond the pool.
  const scheduleState = new TenantScheduleStateStore(options.pool);
  const instrumentation = new SchedulerInstrumentationStore(options.pool);
  const durableBatchStore = new PostgresDurableBatchStore(options.pool);

  // ADR-052 (same-origin proxy, issue #144): every route below that a
  // real BROWSER session calls lives under this sub-app, mounted at
  // /api on the final app further down — apps/web's own page routes
  // (dashboard.tsx, tasks.tsx, ...) already occupy the un-prefixed
  // /dashboard and /tasks paths on the same origin once Vercel proxies
  // /api/* here, so there is no way to keep this sub-app's routes at
  // their un-prefixed paths without colliding with a real page.
  // /billing (Stripe's own webhook target) and /internal/* (operator
  // routes, token-gated, never called by a session-bearing browser) are
  // deliberately NOT part of this sub-app — see their own mount below,
  // unchanged at their current top-level paths so nothing external
  // (Stripe's dashboard config, an operator's bookmarked URL) needs to
  // change alongside this.
  const browserApi = new Hono<AppEnv>()
    .route("/health", healthRoute({ redis: options.scheduler.health, buildSha: options.buildSha }))
    // Better Auth's own basePath config (packages/auth) still names
    // "/api/auth" — that's the path the CLIENT (authClient.ts) and every
    // cookie Better Auth issues expect, and it's exactly what callers
    // outside this origin still see once this sub-app is mounted at
    // /api below (/api + /auth/* = /api/auth/*, unchanged from before
    // the proxy). Only this mount's OWN path lost the /api prefix here,
    // since the wrapping .route("/api", browserApi) call adds it back.
    .all("/auth/*", (c) => options.auth.handler(c.req.raw))
    .use("/me/*", tenantMiddleware(options.pool, options.auth))
    .route("/me", meRoute({ batchStore: options.extraction.batchStore }))
    .route(
      "/me/brain-key",
      brainKeyRoute({ vault: options.trustCore.vault, batchStore: options.extraction.batchStore }),
    )
    .route("/me/ceiling", ceilingRoute({ ceilings }))
    .route(
      "/me/charter",
      charterRoute({
        charters,
        batchStore: options.extraction.batchStore,
        onAccepted: async (tenantId) => {
          const [batch, tier] = await Promise.all([
            options.extraction.batchStore.latestForTenant(tenantId),
            getTenantTier(options.pool, tenantId),
          ]);
          if (!batch?.orgChart) return null; // shouldn't happen post-accept; nothing to schedule if it did
          const { desired, clampNotes } = computeDesiredSchedule(tenantId, tier, batch.orgChart);
          const result = await syncTenantSchedule(options.scheduler.queue, options.scheduler.jobName, tenantId, desired);
          return { ...result, clampNotes };
        },
      }),
    )
    .route(
      "/me/scheduler",
      schedulerRoute({
        charters,
        batchStore: options.extraction.batchStore,
        scheduleState,
        instrumentation,
        durableBatchStore,
        getTenantTier: (tenantId) => getTenantTier(options.pool, tenantId),
        queue: options.scheduler.queue,
        jobName: options.scheduler.jobName,
        notifications: options.scheduler.notifications,
      }),
    )
    .route("/me/digest", digestRoute(options.digest))
    .route(
      "/me/approvals",
      approvalsRoute({
        approvalQueue: options.trustCore.approvalQueue,
        costActivity,
      }),
    )
    .route(
      "/me/tier",
      tierRoute({
        getTenantTier: (tenantId) => getTenantTier(options.pool, tenantId),
      }),
    )
    .route(
      "/me/billing",
      billingCheckoutRoute(options.billing ? { stripe: options.billing.stripe, webOrigin: options.webOrigin } : null),
    )
    .route("/me/hands-keys", handsKeyRoute({ vault: options.trustCore.vault }))
    // Deliberately NOT under tenantMiddleware — see handsOAuth.ts's own
    // comment for why (holding a pooled DB connection open across an
    // external OAuth token-exchange call is worth avoiding, and this
    // route doesn't touch the SQL pool at all). Checks the session
    // directly instead.
    .route(
      "/hands-oauth",
      handsOAuthRoute({
        vault: options.trustCore.vault,
        auth: options.auth,
        webOrigin: options.webOrigin,
        stateSecret: options.handsOAuth.stateSecret,
        google: options.handsOAuth.google,
      }),
    )
    .use("/dashboard/*", tenantMiddleware(options.pool, options.auth))
    .route("/dashboard", dashboardRoute({ costActivity }))
    .use("/tasks/*", tenantMiddleware(options.pool, options.auth))
    .route("/tasks", tasksRoute(options.trustCore))
    .use("/extraction/*", userMiddleware(options.auth))
    .route(
      "/extraction",
      extractionRoute({
        batchStore: options.extraction.batchStore,
        taskDeltaStore: options.extraction.taskDeltaStore,
        costGate: options.trustCore.costGate,
        apiKey: options.extraction.apiKey,
      }),
    )
    .use("/metrics/*", userMiddleware(options.auth))
    .route("/metrics", signupMetricsRoute(options.metrics.metricsStore));

  const app = new Hono<AppEnv>()
    .use("*", cors({ origin: options.webOrigins, credentials: true }))
    .route("/api", browserApi)
    // Deliberately NOT under /api, and NOT under tenantMiddleware or any
    // session check — Stripe calls this directly with no user session at
    // all (still pointed at this exact path in Stripe's own dashboard
    // config; moving it under /api would silently break that webhook
    // until someone updates it there too), and authenticates itself via
    // the request's own signature header (verified inside
    // billingWebhookRoute against options.billing.stripe's webhook
    // secret) — the same trust model this app already uses for nothing
    // else, since Stripe is the first external service allowed to write
    // tenant state unattended.
    .route(
      "/billing",
      billingWebhookRoute(
        options.billing
          ? {
              stripe: options.billing.stripe,
              applyTierChange: (tenantId, tier) =>
                applyTierChange(
                  {
                    setTenantTier: (id, t) => setTenantTier(options.pool, id, t),
                    charters,
                    batchStore: options.extraction.batchStore,
                    queue: options.scheduler.queue,
                    jobName: options.scheduler.jobName,
                  },
                  tenantId,
                  tier,
                ),
              setTenantStripeIds: (tenantId, ids) => setTenantStripeIds(options.pool, tenantId, ids),
            }
          : null,
      ),
    )
    // Deliberately NOT under /api either — operator-only, token-gated,
    // never reached by a session-bearing browser (see internalMetrics.ts),
    // so none of the same-origin cookie reasoning above applies; keeping
    // these at their current path means an operator's existing bookmark
    // or script against the Railway origin keeps working unchanged too.
    .route(
      "/internal/metrics",
      internalMetricsRoute({
        pool: options.pool,
        metricsStore: options.metrics.metricsStore,
        batchStore: options.extraction.batchStore,
        token: options.metrics.internalMetricsToken,
      }),
    )
    .route(
      "/internal/scheduler-debug",
      internalSchedulerDebugRoute({
        queue: options.scheduler.queue,
        connectionHealth: options.scheduler.health,
        token: options.metrics.internalMetricsToken,
      }),
    );

  return app;
}

export type AppType = ReturnType<typeof createApp>;

export { requireStepUp, tenantMiddleware, userMiddleware };
export type { AppEnv, AppSession, TrustCoreDeps } from "./context.js";
