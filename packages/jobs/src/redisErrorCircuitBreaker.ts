/**
 * Issue #160: BullMQ's own `retryIfFailed` (apps/router's dependency,
 * `bullmq`'s Worker internals) deliberately does NOT delay before retrying
 * a command-level Redis error (Upstash's "max requests limit exceeded" is
 * exactly this shape — a real ERR reply on a live connection, not a
 * dropped one). Its `isNotConnectionError` check routes that class of
 * error straight to an immediate re-throw with zero backoff — the delay
 * path only exists for actual connection failures. The Worker's own main
 * loop then just calls back in immediately, so a single command-level
 * error becomes a tight, uninterrupted retry storm: confirmed directly in
 * production deploy logs, where nearly every BullMQ key for both queues
 * was being retried fast enough that Railway's own log pipeline started
 * dropping thousands of lines/sec. That storm is very plausibly what
 * originally burned through the Upstash free-tier request quota, and
 * under pay-as-you-go the same shape is a live, unbounded billing risk.
 *
 * This is deliberately an application-level circuit breaker, not an
 * ioredis reconnect/backoff setting — ioredis's `retryStrategy` only
 * governs reconnecting after the TCP connection itself drops, which is a
 * different failure mode than a healthy connection returning error
 * replies. Nothing in ioredis or BullMQ throttles THIS shape on its own.
 */
export interface CircuitBreakerWorkerLike {
  pause(doNotWaitActive?: boolean): Promise<void>;
  resume(): void;
  on(event: "error", listener: (err: Error) => void): unknown;
}

export interface RedisErrorCircuitBreakerOptions {
  /** Trips once this many errors land within windowMs. Default 10. */
  errorThreshold?: number;
  /** The sliding window errors are counted over, in ms. Default 5000. */
  windowMs?: number;
  /** How long the worker stays paused the first time it trips. Default 30s. */
  initialCooldownMs?: number;
  /** Escalating backoff never exceeds this. Default 10 minutes. */
  maxCooldownMs?: number;
  /** Injectable for tests — real time otherwise. */
  now?: () => number;
  /** Injectable for tests — real setTimeout otherwise. */
  setTimeoutFn?: (fn: () => void, ms: number) => { unref?: () => void };
}

/**
 * Watches a Worker's `error` events; once errorThreshold errors land
 * within windowMs, pauses the worker immediately (doNotWaitActive: true —
 * the point is to stop calling Redis right now, not to wait around for
 * in-flight jobs that may themselves be stuck on the same failure) for
 * cooldownMs, then resumes. Cooldown escalates (doubling, capped at
 * maxCooldownMs) if it trips again shortly after resuming — i.e. Redis is
 * still unhealthy — and resets back to initialCooldownMs once a resume is
 * followed by a genuinely healthy stretch, so a single bad day doesn't
 * leave the worker paused for 10 minutes at a time forever after.
 */
export function attachRedisErrorCircuitBreaker(worker: CircuitBreakerWorkerLike, opts: RedisErrorCircuitBreakerOptions = {}): void {
  const errorThreshold = opts.errorThreshold ?? 10;
  const windowMs = opts.windowMs ?? 5_000;
  const initialCooldownMs = opts.initialCooldownMs ?? 30_000;
  const maxCooldownMs = opts.maxCooldownMs ?? 10 * 60_000;
  const now = opts.now ?? Date.now;
  const scheduleTimeout = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));

  let errorTimestamps: number[] = [];
  let cooldownMs = initialCooldownMs;
  let tripped = false;
  let resumedAt: number | null = null;

  worker.on("error", (err) => {
    if (tripped) return; // already paused and waiting out the cooldown — don't double-count

    const t = now();
    errorTimestamps.push(t);
    errorTimestamps = errorTimestamps.filter((ts) => t - ts <= windowMs);
    if (errorTimestamps.length < errorThreshold) return;

    // Re-tripped soon after the last resume: Redis is still unhealthy —
    // escalate. A trip after a genuinely healthy stretch is a fresh
    // incident, not a continuation — back off to the starting point.
    if (resumedAt !== null && t - resumedAt < cooldownMs * 2) {
      cooldownMs = Math.min(cooldownMs * 2, maxCooldownMs);
    } else {
      cooldownMs = initialCooldownMs;
    }

    tripped = true;
    errorTimestamps = [];
    console.error(
      `[jobs] Redis error circuit breaker tripped: ${errorThreshold}+ errors within ${windowMs}ms ` +
        `(latest: ${err.message}). Pausing this worker for ${cooldownMs}ms instead of retrying immediately.`,
    );
    worker.pause(true).catch((pauseErr: unknown) => {
      console.error("[jobs] Redis error circuit breaker: worker.pause() itself failed:", pauseErr);
    });

    const handle = scheduleTimeout(() => {
      console.error(`[jobs] Redis error circuit breaker: resuming worker after a ${cooldownMs}ms cooldown.`);
      worker.resume();
      tripped = false;
      resumedAt = now();
    }, cooldownMs);
    handle.unref?.();
  });
}
