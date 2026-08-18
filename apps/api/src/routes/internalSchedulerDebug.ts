import type { ConnectionHealth, RepeatableQueueLike } from "@byok/jobs";
import { Hono } from "hono";

export interface InternalSchedulerDebugDeps {
  queue: Pick<RepeatableQueueLike, "getJobSchedulers"> & {
    // Loosely typed, diagnostic-only surface beyond RepeatableQueueLike's
    // narrow production contract — used to tell "the whole connection
    // hangs" apart from "only the Job Scheduler code path hangs" (a real
    // BullMQ 6.x Queue satisfies this structurally, no cast needed at the
    // call site).
    getJobCounts?: (...types: string[]) => Promise<Record<string, number>>;
  };
  /** packages/jobs's trackConnectionHealth output for both the Queue's and
   *  the Worker's own Redis connections — the permanent, version-
   *  independent replacement for reaching into BullMQ internals
   *  (Queue#getBackend().connection.status) the way this route's first
   *  version did during the original investigation. Unlike that hack,
   *  this survives whichever BullMQ/ioredis version is installed. */
  connectionHealth: { queue: ConnectionHealth; worker: ConnectionHealth };
  /** Reuses internalMetrics.ts's own platform credential (ADR-003-style,
   *  not a user credential) rather than minting a second token for one
   *  more operator-only, no-tenant-scope debug view. */
  token: string;
}

/**
 * Diagnostic-only: reports Redis connection health plus every BullMQ Job
 * Scheduler currently registered, across all tenants. Exists because R3
 * staging verification spent real, avoidable time unable to tell "the
 * /sync call never registered anything" apart from "something's
 * registered but BullMQ isn't dispatching it" apart from "the connection
 * itself never became ready" — three failure modes that look identical
 * from outside (scheduler_instrumentation_daily just stays empty either
 * way) but point at completely different bugs. This route answers that
 * directly, from inside Railway's own network, without needing a tenant
 * session. Token-gated like internalMetrics.ts, same reasoning.
 */
export function internalSchedulerDebugRoute(deps: InternalSchedulerDebugDeps) {
  return new Hono().get("/", async (c) => {
    const provided = c.req.header("x-internal-metrics-token") ?? "";
    if (!timingSafeEqual(provided, deps.token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Racing each probe against its own short client-side timeout (rather
    // than trusting the queue connection's own commandTimeout, which is
    // exactly the thing under investigation here) so one hung call can't
    // stop the other's result from ever being reported.
    const [jobCounts, schedulers] = await Promise.all([
      withTimeout(deps.queue.getJobCounts?.(), 8000, "getJobCounts"),
      withTimeout(deps.queue.getJobSchedulers(), 8000, "getJobSchedulers"),
    ]);

    return c.json({ connectionHealth: deps.connectionHealth, jobCounts, schedulers });
  });
}

async function withTimeout<T>(promise: Promise<T> | undefined, ms: number, label: string): Promise<{ ok: true; ms: number; value: T } | { ok: false; ms: number; error: string }> {
  if (!promise) return { ok: false, ms: 0, error: `${label} not available on this queue` };
  const start = Date.now();
  try {
    const value = await Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms)),
    ]);
    return { ok: true, ms: Date.now() - start, value };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Same timing-safe comparison as internalMetrics.ts — identical
 *  reasoning, duplicated rather than shared because these two routes
 *  don't otherwise depend on each other and a shared util for one
 *  four-line function isn't worth the indirection. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
