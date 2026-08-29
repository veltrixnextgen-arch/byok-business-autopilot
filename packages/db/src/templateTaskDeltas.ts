import { withInternalMetricsScope } from "./signupMetrics.js";
import { withUserScope } from "./userContext.js";
import type { PoolLike } from "./tenantContext.js";

export type TemplateTaskDeltaKind = "added" | "removed" | "frequency_changed";
export type TemplateTaskDeltaSource = "generation" | "reassemble";

/** Structurally matches @byok/agents/extraction's TaskDelta — not
 *  imported from there directly, since db sits below extraction in the
 *  dependency graph (db has no @byok/agents dependency today). */
export interface TemplateTaskDeltaInput {
  taskId: string;
  kind: TemplateTaskDeltaKind;
  detail: Record<string, unknown> | null;
}

export interface RemovedPattern {
  templateId: string;
  taskId: string;
  userCount: number;
}

export interface FrequencyChangedPattern {
  templateId: string;
  taskId: string;
  from: string;
  to: string;
  userCount: number;
}

/** Deliberately excludes `detail.text` — see recordMany's own header
 *  comment and aggregatedPatterns' doc comment for why: the literal wording
 *  of an "added" task is the one free-text field on this table, and
 *  surfacing it in an aggregate signal is exactly the cross-tenant leakage
 *  docs/STATUS.md's template-learning entry names as the thing to avoid. */
export interface AddedPattern {
  templateId: string;
  agentType: string;
  teamHint: string;
  frequency: string;
  tier: string;
  autonomy: string;
  origin: string;
  userCount: number;
}

export interface AggregatedPatterns {
  removed: RemovedPattern[];
  frequencyChanged: FrequencyChangedPattern[];
  added: AddedPattern[];
}

/**
 * Template-learning capture layer (docs/STATUS.md's "template-learning
 * scoping" item; Phase C item 7, docs/strategy/runwisely-master-vision.md
 * §12) — user-scoped writes (ADR-015, see migrations/0016_template_task_
 * deltas.sql) since the batches these deltas belong to are themselves
 * pre-tenant. Reading ACROSS users (aggregatedPatterns) is the same narrow
 * app.internal_metrics RLS exception signupMetrics.ts's
 * withInternalMetricsScope already carves for the funnel/feedback tables —
 * see migrations/0021_template_task_delta_internal_metrics.sql.
 */
export class TemplateTaskDeltaStore {
  constructor(private readonly pool: PoolLike) {}

  async recordMany(
    userId: string,
    batchId: string,
    templateId: string,
    deltas: readonly TemplateTaskDeltaInput[],
    source: TemplateTaskDeltaSource,
  ): Promise<void> {
    if (deltas.length === 0) return;
    await withUserScope(this.pool, userId, async (client) => {
      const values: string[] = [];
      const params: unknown[] = [];
      for (const d of deltas) {
        const base = params.length;
        values.push(`($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7})`);
        params.push(userId, batchId, templateId, d.taskId, d.kind, d.detail === null ? null : JSON.stringify(d.detail), source);
      }
      await client.query(
        `INSERT INTO template_task_deltas (user_id, batch_id, template_id, task_id, delta_kind, detail, source)
         VALUES ${values.join(", ")}`,
        params,
      );
    });
  }

  /**
   * Structural-only, threshold-gated signal for the human-reviewed
   * template-improvement step (Phase C item 7) — NOT a proposed template
   * change, just "here's a pattern worth a person looking at." Two
   * deliberate redaction choices, both cheaper than building a PII
   * scrubber: (1) `detail.text` (the one free-text field on this table,
   * "added" deltas only) never appears in the grouping or the output —
   * clustering happens on the already-enum-like fields alone
   * (agentType/teamHint/frequency/tier/autonomy/origin); (2) a pattern
   * only surfaces once it's independently occurred across at least
   * `minDistinctUsers` users — a single business's own one-off edit isn't
   * a template signal, and a `HAVING count(DISTINCT user_id) >= N` clause
   * is the whole mechanism, not a new redaction system. `removed`'s
   * task_id and `frequency_changed`'s from/to are already non-identifying
   * (a template's own stable task id, an enum-like frequency value) so
   * they're surfaced as-is.
   */
  async aggregatedPatterns(minDistinctUsers: number): Promise<AggregatedPatterns> {
    return withInternalMetricsScope(this.pool, async (client) => {
      const removed = (await client.query(
        `SELECT template_id, task_id, count(DISTINCT user_id) AS user_count
         FROM template_task_deltas
         WHERE delta_kind = 'removed'
         GROUP BY template_id, task_id
         HAVING count(DISTINCT user_id) >= $1
         ORDER BY user_count DESC`,
        [minDistinctUsers],
      )) as unknown as { rows: Array<{ template_id: string; task_id: string; user_count: string }> };

      const frequencyChanged = (await client.query(
        `SELECT template_id, task_id, detail->>'from' AS from_freq, detail->>'to' AS to_freq, count(DISTINCT user_id) AS user_count
         FROM template_task_deltas
         WHERE delta_kind = 'frequency_changed'
         GROUP BY template_id, task_id, detail->>'from', detail->>'to'
         HAVING count(DISTINCT user_id) >= $1
         ORDER BY user_count DESC`,
        [minDistinctUsers],
      )) as unknown as {
        rows: Array<{ template_id: string; task_id: string; from_freq: string; to_freq: string; user_count: string }>;
      };

      const added = (await client.query(
        `SELECT template_id,
                detail->>'agentType' AS agent_type,
                detail->>'teamHint' AS team_hint,
                detail->>'frequency' AS frequency,
                detail->>'tier' AS tier,
                detail->>'autonomy' AS autonomy,
                detail->>'origin' AS origin,
                count(DISTINCT user_id) AS user_count
         FROM template_task_deltas
         WHERE delta_kind = 'added'
         GROUP BY template_id, detail->>'agentType', detail->>'teamHint', detail->>'frequency', detail->>'tier', detail->>'autonomy', detail->>'origin'
         HAVING count(DISTINCT user_id) >= $1
         ORDER BY user_count DESC`,
        [minDistinctUsers],
      )) as unknown as {
        rows: Array<{
          template_id: string;
          agent_type: string;
          team_hint: string;
          frequency: string;
          tier: string;
          autonomy: string;
          origin: string;
          user_count: string;
        }>;
      };

      return {
        removed: removed.rows.map((r) => ({ templateId: r.template_id, taskId: r.task_id, userCount: Number(r.user_count) })),
        frequencyChanged: frequencyChanged.rows.map((r) => ({
          templateId: r.template_id,
          taskId: r.task_id,
          from: r.from_freq,
          to: r.to_freq,
          userCount: Number(r.user_count),
        })),
        added: added.rows.map((r) => ({
          templateId: r.template_id,
          agentType: r.agent_type,
          teamHint: r.team_hint,
          frequency: r.frequency,
          tier: r.tier,
          autonomy: r.autonomy,
          origin: r.origin,
          userCount: Number(r.user_count),
        })),
      };
    });
  }
}
