import type { AggregatedPatterns, TemplateTaskDeltaStore } from "@byok/db";
import { Hono } from "hono";

export interface TemplateLearningPatternsDeps {
  deltaStore: Pick<TemplateTaskDeltaStore, "aggregatedPatterns">;
  /** Reuses internalMetrics.ts's own platform credential (ADR-003-style),
   *  same reasoning as internalSchedulerDebug.ts — one more operator-only,
   *  no-tenant-scope view, not a reason to mint a second token. */
  token: string;
}

const DEFAULT_MIN_DISTINCT_USERS = 5;

/**
 * Phase C item 7 (docs/strategy/runwisely-master-vision.md §12): surfaces
 * template-improvement signal from captured edits (packages/db's
 * template_task_deltas) — structural patterns only, gated on a minimum
 * distinct-user count, per TemplateTaskDeltaStore.aggregatedPatterns' own
 * doc comment. This is deliberately the END of what this route does: it
 * answers "what's worth a human looking at," never "here's the template
 * diff to apply." Turning a surfaced pattern into an actual proposed
 * change to a template file is a separate, larger, human-review workflow
 * question this route does not touch.
 *
 * `?minUsers=` overrides the default threshold for exploration (e.g.
 * lowering it during the 20-tester pilot, where 5 independent occurrences
 * may never happen) — never below 2, so a single business's own edit can
 * never surface as if it were a pattern.
 */
export function templateLearningPatternsRoute(deps: TemplateLearningPatternsDeps) {
  return new Hono().get("/", async (c) => {
    const provided = c.req.header("x-internal-metrics-token") ?? "";
    if (!timingSafeEqual(provided, deps.token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const requested = Number(c.req.query("minUsers"));
    const minDistinctUsers = Number.isFinite(requested) && requested >= 2 ? Math.floor(requested) : DEFAULT_MIN_DISTINCT_USERS;

    const patterns: AggregatedPatterns = await deps.deltaStore.aggregatedPatterns(minDistinctUsers);
    return c.json({ minDistinctUsers, ...patterns });
  });
}

/** Same reasoning as internalMetrics.ts's own copy — avoids a
 *  short-circuit-on-first-mismatch timing side channel for a bearer-token
 *  comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
