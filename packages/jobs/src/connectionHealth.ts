export type ConnectionHealthStatus = "initializing" | "ready" | "error";

/**
 * Live, synchronously-readable health of one Redis connection (a Queue's or
 * a Worker's — each owns its own physical connection in BullMQ). Mutated in
 * place as the real outcome resolves, so callers (health checks, debug
 * routes) can read `.status` at any time without awaiting anything
 * themselves — the whole point is to have something to read even while the
 * connection is still stuck.
 */
export interface ConnectionHealth {
  status: ConnectionHealthStatus;
  /** Set only when status is "error" — the timeout message or the
   *  underlying connection error, whichever fires first. */
  error?: string;
  /** Set only when status is "ready" — Date.now() at the moment it did. */
  readyAtMs?: number;
}

export interface WaitUntilReadyLike {
  waitUntilReady(): Promise<unknown>;
}

/**
 * Races a Queue's or Worker's own `waitUntilReady()` (BullMQ's public,
 * version-stable readiness API — backed by RedisConnection internally,
 * but this function never touches that directly, so it keeps working
 * whichever BullMQ/ioredis version is installed) against a hard timeout.
 *
 * Exists because BullMQ's own connection bootstrap has no timeout of its
 * own: a connection that never reaches "ready" and never errors just hangs
 * forever, silently, with nothing to observe except every downstream
 * command also hanging — confirmed directly in staging (GET /internal/
 * scheduler-debug hanging 8s+ with zero response, zero server-side error,
 * traced to RedisConnection.status stuck at "initializing" indefinitely).
 * That failure mode is what turned a two-minute check into two days: with
 * this wrapper, the same failure surfaces as an immediate, loud "error"
 * status instead.
 */
export function trackConnectionHealth(client: WaitUntilReadyLike, timeoutMs = 15000): ConnectionHealth {
  const health: ConnectionHealth = { status: "initializing" };
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Redis connection did not become ready within ${timeoutMs}ms`)), timeoutMs).unref(),
  );

  Promise.race([client.waitUntilReady(), timeout])
    .then(() => {
      health.status = "ready";
      health.readyAtMs = Date.now();
    })
    .catch((err: unknown) => {
      health.status = "error";
      health.error = err instanceof Error ? err.message : String(err);
      // Loud on purpose (console.error, not a swallowed rejection) --
      // ADR-TBD's whole point is that this class of failure was
      // previously silent. Railway's log pipeline picks this up
      // immediately regardless of whether anything ever polls /health.
      console.error(`[jobs] Redis connection failed to become ready: ${health.error}`);
    });

  return health;
}
