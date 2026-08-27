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

/**
 * Template-learning capture layer (docs/STATUS.md's "template-learning
 * scoping" item) — write-only for now, by design: no aggregation, no
 * cross-tenant/cross-user reads. User-scoped (ADR-015, see
 * migrations/0016_template_task_deltas.sql) since the batches these
 * deltas belong to are themselves pre-tenant.
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
}
