import { serve } from "@hono/node-server";
import { createAuth } from "@byok/auth";
import { PostgresDurableBatchStore, PostgresReservationStore } from "@byok/cost-gate";
import {
  CompanyCharterStore,
  createDb,
  createPool,
  getTenantOwnerEmails,
  SchedulerInstrumentationStore,
  SignupExtractionBatchStore,
  SignupMetricsStore,
  TenantCeilingStore,
  TenantScheduleStateStore,
} from "@byok/db";
import { createRepeatableQueue, createTenantWorker, trackConnectionHealth } from "@byok/jobs";
import { createEmailSender } from "@byok/notifications";
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
  const crossSiteCookies = env.CROSS_SITE_COOKIES === "true";

  const googleClientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const google =
    googleClientId && googleClientSecret
      ? { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: `${authBaseUrl}/hands-oauth/google-calendar/callback` }
      : null;

  const resendApiKey = env.RESEND_API_KEY;
  const notificationsFromEmail = env.NOTIFICATIONS_FROM_EMAIL ?? "Runwisely <onboarding@resend.dev>";

  return {
    port,
    databaseUrl,
    authSecret,
    authBaseUrl,
    webOrigin,
    crossSiteCookies,
    anthropicApiKey,
    internalMetricsToken,
    google,
    redisUrl,
    resendApiKey,
    notificationsFromEmail,
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
    trustedOrigins: [config.webOrigin],
    crossSiteCookies: config.crossSiteCookies,
  });
  const batchStore = new SignupExtractionBatchStore(pool);
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

  const scheduledDispatchProcessor = createScheduledDispatchProcessor({
    router: trustCore.router,
    charters: new CompanyCharterStore(pool),
    batchStore,
    scheduleState: new TenantScheduleStateStore(pool),
    instrumentation: new SchedulerInstrumentationStore(pool),
    durableBatchStore: new PostgresDurableBatchStore(pool),
    tierModelMap: trustCore.tierModelMap,
    notifications: scheduleNotifications,
  });
  const worker = createTenantWorker<ScheduledDispatchPayload>(
    SCHEDULED_DISPATCH_JOB_NAME,
    (job) => scheduledDispatchProcessor(job.data),
    { connection: redisConnection },
  );
  const workerHealth = trackConnectionHealth(worker, 15_000);

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
    scheduler: {
      queue,
      jobName: SCHEDULED_DISPATCH_JOB_NAME,
      health: { queue: queueHealth, worker: workerHealth },
      notifications: scheduleNotifications,
    },
  });

  return serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`@byok/api listening on http://localhost:${info.port}`);
    console.log(`crossSiteCookies=${config.crossSiteCookies} authBaseUrl=${config.authBaseUrl} webOrigin=${config.webOrigin}`);
  });
}
