import { serve } from "@hono/node-server";
import { createAuth } from "@byok/auth";
import { PostgresDurableBatchStore, PostgresReservationStore } from "@byok/cost-gate";
import {
  CompanyCharterStore,
  createDb,
  createPool,
  getTenantOwnerEmails,
  listAllTenantIds,
  SchedulerInstrumentationStore,
  SignupExtractionBatchStore,
  SignupMetricsStore,
  TemplateTaskDeltaStore,
  TenantCeilingStore,
  TenantScheduleStateStore,
} from "@byok/db";
import { attachRedisErrorCircuitBreaker, createPlatformWorker, createRepeatableQueue, createTenantWorker, trackConnectionHealth } from "@byok/jobs";
import { createEmailSender } from "@byok/notifications";
import { PostgresCostActivityQueries } from "@byok/router";
import { createStripeClient } from "./billing/stripeClient.js";
import { createStripePriceMapFromEnv, type StripePriceMap } from "./billing/priceMap.js";
import type { DigestDeps } from "./digest/buildDigestData.js";
import { sendDailyDigests } from "./digest/sendDailyDigests.js";
import type { TrustCoreDeps } from "./context.js";
import { createApp } from "./index.js";
import type { ScheduledDispatchPayload } from "./scheduler/computeDesiredSchedule.js";
import { createScheduledDispatchProcessor } from "./scheduler/scheduledDispatchProcessor.js";
import type { ScheduleNotificationDeps } from "./scheduler/scheduleNotifications.js";

// One BullMQ queue/job name for every tenant's scheduled-dispatch jobs —
// tenantScheduler.ts's own jobId-prefix scoping (`${tenantId}:...`) is what
// keeps tenants isolated within it, the same way router_tasks/audit_log
// share one table with RLS rather than a table per tenant.
export const SCHEDULED_DISPATCH_JOB_NAME = "scheduled-dispatch";

// R4: ONE repeatable job for the whole platform, not one per tenant — its
// handler loops over every tenant in a single execution (sendDailyDigests.ts).
// A daily email is cheap; scheduling N of them separately isn't free the
// way scheduled-dispatch's per-tenant jobs already justify being.
export const DIGEST_DAILY_JOB_NAME = "digest-daily";

export interface ServerConfig {
  port: number;
  databaseUrl: string;
  authSecret: string;
  authBaseUrl: string;
  webOrigin: string;
  /** Every trusted web origin — always includes webOrigin, plus whatever
   *  ADDITIONAL_WEB_ORIGINS (comma-separated) adds. Used for CORS and
   *  Better Auth's trustedOrigins, the two places that must accept more
   *  than one exact origin (a browser sends the one the user actually
   *  typed); every other call site in this file wants the single
   *  canonical webOrigin instead, not this list. */
  webOrigins: string[];
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
  /** R3/ADR-025: backs the scheduler's BullMQ repeatable-job registry.
   *  Required, same discipline as DATABASE_URL — a server that can't run
   *  its own scheduled dispatch should fail at startup, not silently
   *  never schedule anything. Already wired through CI/deploy-staging and
   *  .env.example (redis://localhost:6379 locally, an Upstash rediss://
   *  URL in staging) — this is the first real consumer. */
  redisUrl: string;
  /** Issue #140: backs the schedule-pause/resume email. NOT required like
   *  anthropicApiKey/redisUrl above — this codebase had zero email
   *  infrastructure before this, and a deploy missing this key should
   *  still boot (notifications just log loudly instead of sending, via
   *  @byok/notifications' LoggingEmailSender — see createEmailSender).
   *  Get one at resend.com; `fromAddress` defaults to their pre-verified
   *  sandbox sender (onboarding@resend.dev) so this works with zero setup
   *  beyond an API key — a real deployment should set NOTIFICATIONS_FROM_EMAIL
   *  to an address on a verified domain instead. */
  resendApiKey?: string;
  notificationsFromEmail: string;
  /** ADR-029: self-reported build identity, surfaced on GET /health as
   *  `buildSha`. Not required (unlike DATABASE_URL etc.) — local dev has
   *  no BUILD_SHA and must still boot; "unknown" there is honest, not a
   *  bug. deploy-staging.yml sets BUILD_SHA=$GITHUB_SHA on Railway before
   *  every deploy specifically so its own post-deploy check has something
   *  real to compare against — see that workflow's "Verify the deployment
   *  actually succeeded" step. */
  buildSha: string;
  /** Issue #18/ADR-045: Stripe billing. Same optionality pattern as
   *  `google` above — a real Stripe account with all six real Prices
   *  (ADR-044's prices) doesn't exist yet anywhere this app runs, and a
   *  deploy missing it must still boot. `null` means /me/billing/checkout
   *  and /billing/webhook 503 cleanly (routes/billing.ts) rather than the
   *  whole server refusing to start. Setting STRIPE_SECRET_KEY,
   *  STRIPE_WEBHOOK_SECRET, and the three STRIPE_PRICE_* env vars (see
   *  billing/priceMap.ts) is the only remaining step once a real account
   *  exists — no code changes required, same as Google's own comment. */
  stripe: { secretKey: string; webhookSecret: string; priceMap: StripePriceMap } | null;
}

export function readServerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const databaseUrl = env.DATABASE_URL;
  const authSecret = env.BETTER_AUTH_SECRET;
  const anthropicApiKey = env.ANTHROPIC_API_KEY;
  const internalMetricsToken = env.INTERNAL_METRICS_TOKEN;
  const redisUrl = env.REDIS_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!authSecret) throw new Error("BETTER_AUTH_SECRET is required");
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required");
  if (!internalMetricsToken) throw new Error("INTERNAL_METRICS_TOKEN is required");
  if (!redisUrl) throw new Error("REDIS_URL is required");

  const port = Number(env.PORT ?? 3000);
  const authBaseUrl = env.BETTER_AUTH_URL ?? `http://localhost:${port}`;
  const webOrigin = env.WEB_ORIGIN ?? "http://localhost:3002";
  // A single hardcoded WEB_ORIGIN is exactly what broke sign-in the moment
  // this product moved from a Vercel-generated domain to a real one: CORS
  // and Better Auth's trustedOrigins both only ever trusted one exact
  // origin, so adding www.runwisely.cc/runwisely.cc meant either one
  // (whichever wasn't WEB_ORIGIN) got a blocked CORS preflight. Optional,
  // comma-separated, additive — WEB_ORIGIN stays the one canonical value
  // every redirect/URL-building call site in this file still uses.
  const additionalWebOrigins = (env.ADDITIONAL_WEB_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  const webOrigins = [...new Set([webOrigin, ...additionalWebOrigins])];
  const crossSiteCookies = env.CROSS_SITE_COOKIES === "true";

  const googleClientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  // Issue found live 2026-09-04 recording the OAuth demo video: this must
  // be webOrigin (the proxied www.runwisely.cc origin apps/web's own
  // vercel.json rewrites /api/* through to this same backend), NOT
  // authBaseUrl (the raw Railway domain). Better Auth's session cookie is
  // scoped to webOrigin — Google redirects the browser here as a
  // top-level navigation, and a request landing on a genuinely different
  // domain (the raw Railway one) never carries that cookie at all, no
  // matter the cookie's SameSite/Domain settings. The callback's own
  // session check (handsOAuth.ts) then always sees no session and fails
  // closed as "state_mismatch" — every attempt, not a flake. The
  // registered-redirect-URI check done earlier only verified this string
  // matched Google's console entry; it never verified a live callback
  // round-trip actually completing, which is what caught this.
  const google =
    googleClientId && googleClientSecret
      ? { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: `${webOrigin}/api/hands-oauth/google-calendar/callback` }
      : null;

  const resendApiKey = env.RESEND_API_KEY;
  const notificationsFromEmail = env.NOTIFICATIONS_FROM_EMAIL ?? "Runwisely <onboarding@resend.dev>";
  const buildSha = env.BUILD_SHA ?? "unknown";

  // Issue #18/ADR-045. All-or-nothing: STRIPE_SECRET_KEY present means a
  // real Stripe account exists, so the three STRIPE_PRICE_* env vars
  // (createStripePriceMapFromEnv) are required too and this throws
  // loudly on a half-configured deploy rather than booting with billing
  // silently broken. STRIPE_SECRET_KEY absent means no Stripe account
  // exists yet at all — stripe: null, same "feature wired, inert until
  // configured" pattern as `google` above.
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const stripe =
    stripeSecretKey && stripeWebhookSecret
      ? { secretKey: stripeSecretKey, webhookSecret: stripeWebhookSecret, priceMap: createStripePriceMapFromEnv(env) }
      : null;

  return {
    port,
    databaseUrl,
    authSecret,
    authBaseUrl,
    webOrigin,
    webOrigins,
    crossSiteCookies,
    anthropicApiKey,
    internalMetricsToken,
    google,
    redisUrl,
    resendApiKey,
    notificationsFromEmail,
    buildSha,
    stripe,
  };
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
    trustedOrigins: config.webOrigins,
    crossSiteCookies: config.crossSiteCookies,
  });
  const batchStore = new SignupExtractionBatchStore(pool);
  const taskDeltaStore = new TemplateTaskDeltaStore(pool);
  const metricsStore = new SignupMetricsStore(pool);

  // R3/ADR-025: the scheduler's own repeatable-job registry and worker.
  // Deliberately started IN-PROCESS with the HTTP server, not as a
  // separate deployable — see docs/TRACKING.md's Railway phantom-service
  // incident (an accidentally-provisioned second service crash-looped for
  // days on the wrong start command). A dedicated worker process is a
  // legitimate future scaling change; it is not free to reach for here
  // just because it's the "more correct" shape, given this repo's own
  // burned lesson about auto-provisioned services.
  const redisConnection = { url: config.redisUrl };
  // Queue-side commands (upsertJobScheduler/getJobSchedulers/etc., issued
  // from HTTP routes like /me/scheduler/sync) are all non-blocking — unlike
  // ioredis's default of retrying/queuing indefinitely against a connection
  // that keeps getting reset (observed live: Upstash resets the idle TCP
  // connection roughly every 30s, and ioredis's default reconnect behavior
  // left a getJobSchedulers() call hanging with no response and no error
  // for 30+ seconds, well past what any HTTP caller would wait), a bounded
  // commandTimeout makes a broken connection fail loud and fast instead.
  // Deliberately NOT applied to the Worker's own connection below: BullMQ's
  // Worker relies on long-lived blocking commands (BRPOPLPUSH-style) to
  // wait for new jobs, which a command timeout would interrupt and treat
  // as a hang that isn't one.
  const queueRedisConnection = { url: config.redisUrl, commandTimeout: 10_000 };
  const queue = createRepeatableQueue(SCHEDULED_DISPATCH_JOB_NAME, { connection: queueRedisConnection });
  // BullMQ's own connection bootstrap (RedisConnection.waitUntilReady) has
  // no timeout of its own -- a connection that never reaches "ready" and
  // never errors just hangs forever, silently, with nothing to observe
  // except every downstream command also hanging. Confirmed directly in
  // staging: stuck at RedisConnection.status "initializing" indefinitely,
  // with zero server-side errors, turning a two-minute check into two days
  // of investigation. trackConnectionHealth races each connection's own
  // waitUntilReady() against a hard timeout so that failure mode surfaces
  // immediately and loudly (console.error) instead. Threaded through to
  // /health and /internal/scheduler-debug below as a first-class signal --
  // the API must never report "ok" while its queue backend is dead.
  const queueHealth = trackConnectionHealth(queue, 15_000);

  // Issue #140: a schedule pausing must be visible, not silently
  // discovered later. Read-only reuse of the same store classes
  // trust-core's own bootstrap constructs internally (thin pool wrappers,
  // cheap to build a second time — same reasoning as index.ts's
  // costActivity/ceilings/charters) rather than threading trust-core's
  // own internal instances out through TrustCoreDeps.
  const notificationEmailSender = createEmailSender({
    resendApiKey: config.resendApiKey,
    fromAddress: config.notificationsFromEmail,
  });
  const notificationReservationStore = new PostgresReservationStore(pool);
  const notificationCeilings = new TenantCeilingStore(pool);
  const scheduleNotifications: ScheduleNotificationDeps = {
    getOwnerEmails: (tenantId) => getTenantOwnerEmails(pool, tenantId),
    emailSender: notificationEmailSender,
    ceilings: notificationCeilings,
    reservationTotals: notificationReservationStore,
    dashboardUrl: `${config.webOrigin}/dashboard`,
  };

  // R4: the digest reuses #140's owner-email lookup and the same
  // ceiling/reservation store instances above rather than building a
  // second notification path — one never-throws discipline, not two.
  const digestDeps: DigestDeps = {
    charters: new CompanyCharterStore(pool),
    batchStore,
    costActivity: new PostgresCostActivityQueries(pool),
    approvalQueue: trustCore.approvalQueue,
    ceilings: notificationCeilings,
    reservationTotals: notificationReservationStore,
  };
  const digestQueue = createRepeatableQueue(DIGEST_DAILY_JOB_NAME, { connection: queueRedisConnection });
  // No per-tenant timezone exists yet (a real gap, not solved here) — a
  // fixed UTC hour is the honest "smallest thing that works" default: 13:00
  // UTC lands in the morning across US timezones, which is what most of
  // this product's early tenants are in. upsertJobScheduler is idempotent,
  // so re-registering on every boot is safe, not a duplicate-job risk.
  void digestQueue
    .upsertJobScheduler(DIGEST_DAILY_JOB_NAME, { pattern: "0 13 * * *" }, { data: {} })
    .catch((err) => console.error("Failed to register the daily digest job scheduler:", err));
  const digestWorker = createPlatformWorker(
    DIGEST_DAILY_JOB_NAME,
    async () => {
      const summary = await sendDailyDigests({
        listTenantIds: () => listAllTenantIds(pool),
        digest: digestDeps,
        getOwnerEmails: (tenantId) => getTenantOwnerEmails(pool, tenantId),
        emailSender: notificationEmailSender,
        dashboardUrl: `${config.webOrigin}/dashboard`,
      });
      console.log(`Daily digest batch: ${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed`);
    },
    { connection: redisConnection },
  );
  // Tracked for the same reason queueHealth/workerHealth are below — a
  // connection stuck at "initializing" forever with no error is exactly
  // this codebase's own burned lesson (see queueHealth's comment above).
  // Not surfaced through /health (that route is specifically about the
  // scheduled-dispatch pipeline's own criticality); logged loudly instead
  // so a stuck digest connection is at least visible in server logs.
  trackConnectionHealth(digestQueue, 15_000);
  trackConnectionHealth(digestWorker, 15_000);
  // Issue #160: a command-level Redis error (Upstash's request-quota
  // rejection, observed live) gets zero backoff from BullMQ itself — its
  // own retry classifies that as "not a connection error" and re-throws
  // immediately, so the Worker's main loop just calls back in right away.
  // Confirmed in production logs as a tight, uninterrupted retry storm
  // across every BullMQ key. Pausing the worker on a burst of errors, with
  // an escalating cooldown, is the applied fix — see
  // redisErrorCircuitBreaker.ts for the full mechanism and why this can't
  // be solved with ioredis's own retryStrategy/maxRetriesPerRequest.
  attachRedisErrorCircuitBreaker(digestWorker);

  const scheduledDispatchProcessor = createScheduledDispatchProcessor({
    router: trustCore.router,
    charters: new CompanyCharterStore(pool),
    batchStore,
    scheduleState: new TenantScheduleStateStore(pool),
    instrumentation: new SchedulerInstrumentationStore(pool),
    durableBatchStore: new PostgresDurableBatchStore(pool),
    tierModelMaps: trustCore.tierModelMaps,
    vault: trustCore.vault,
    notifications: scheduleNotifications,
  });
  const worker = createTenantWorker<ScheduledDispatchPayload>(
    SCHEDULED_DISPATCH_JOB_NAME,
    (job) => scheduledDispatchProcessor(job.data),
    { connection: redisConnection },
  );
  const workerHealth = trackConnectionHealth(worker, 15_000);
  attachRedisErrorCircuitBreaker(worker); // issue #160 — see digestWorker's own comment above

  const app = createApp({
    pool,
    auth,
    trustCore,
    webOrigin: config.webOrigin,
    webOrigins: config.webOrigins,
    extraction: { batchStore, taskDeltaStore, apiKey: config.anthropicApiKey },
    metrics: { metricsStore, internalMetricsToken: config.internalMetricsToken },
    // Reuses authSecret for state-token signing (ADR-021) — see
    // oauth/state.ts's own comment on why a second required secret isn't
    // needed for this.
    handsOAuth: { stateSecret: config.authSecret, google: config.google },
    scheduler: {
      queue,
      jobName: SCHEDULED_DISPATCH_JOB_NAME,
      health: { queue: queueHealth, worker: workerHealth },
      notifications: scheduleNotifications,
    },
    digest: digestDeps,
    buildSha: config.buildSha,
    billing: config.stripe
      ? { stripe: createStripeClient(config.stripe.secretKey, config.stripe.webhookSecret, config.stripe.priceMap) }
      : null,
  });

  return serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`@byok/api listening on http://localhost:${info.port}`);
    console.log(
      `crossSiteCookies=${config.crossSiteCookies} authBaseUrl=${config.authBaseUrl} webOrigin=${config.webOrigin} webOrigins=${config.webOrigins.join(",")}`,
    );
  });
}
