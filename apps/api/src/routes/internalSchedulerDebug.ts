import type { RepeatableQueueLike } from "@byok/jobs";
import { Hono } from "hono";

export interface InternalSchedulerDebugDeps {
  queue: Pick<RepeatableQueueLike, "getJobSchedulers">;
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

    const schedulers = await deps.queue.getJobSchedulers();
    return c.json({ count: schedulers.length, schedulers });
  });
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
