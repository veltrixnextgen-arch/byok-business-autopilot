import type { RepeatableQueueLike } from "@byok/jobs";
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
  /** Reuses internalMetrics.ts's own platform credential (ADR-003-style,
   *  not a user credential) rather than minting a second token for one
   *  more operator-only, no-tenant-scope debug view. */
  token: string;
}

/**
 * Diagnostic-only: lists every BullMQ Job Scheduler currently registered
 * in Redis, across all tenants. Exists because R3 staging verification
 * spent real, avoidable time unable to tell "the /sync call never
 * registered anything" apart from "something's registered but BullMQ
 * isn't dispatching it" — the two failure modes look identical from
 * outside (both show scheduler_instrumentation_daily staying empty), but
 * point at completely different bugs (an app-side registration problem
 * vs. a BullMQ/Redis dispatch problem). This route answers that directly,
 * from inside Railway's own network, without needing a tenant session.
 * Token-gated like internalMetrics.ts, same reasoning.
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

    return c.json({ jobCounts, schedulers });
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
