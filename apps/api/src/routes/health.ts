import type { ConnectionHealth } from "@byok/jobs";
import { Hono } from "hono";
import type { AppEnv } from "../context.js";

export interface HealthRouteDeps {
  redis: { queue: ConnectionHealth; worker: ConnectionHealth };
}

/**
 * Deliberately still always returns HTTP 200 — Railway's own deploy
 * verification (and any other infra health check) gates on this
 * endpoint's status code, and a transient "initializing" status during
 * every normal cold start (up to trackConnectionHealth's own timeout,
 * currently 15s) would otherwise fail a healthy deploy. What changes is
 * the response BODY: `redis.queue`/`redis.worker` now report their real
 * status ("initializing" | "ready" | "error") instead of the endpoint
 * staying silent about a broken queue backend. Only the status enum is
 * exposed here, not the underlying error message (kept off this public,
 * unauthenticated route) — the full detail is on the token-gated
 * /internal/scheduler-debug route.
 */
export function healthRoute(deps: HealthRouteDeps) {
  return new Hono<AppEnv>().get("/", (c) =>
    c.json({
      status: "ok",
      redis: { queue: deps.redis.queue.status, worker: deps.redis.worker.status },
    }),
  );
}
