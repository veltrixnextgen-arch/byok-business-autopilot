import type { CustomizationLog, Task } from "./types.js";

/**
 * Template-learning data capture (docs/STATUS.md's "template-learning
 * scoping" item) — this is deliberately ONLY the capture layer. No
 * aggregation, no cross-tenant reads, no redaction design: reassemble/
 * updateOrgChart overwriting the org chart with no history meant every
 * edit's signal was lost the moment it happened, unrecoverably. This
 * stops that, nothing more — what (if anything) ever reads these rows
 * is a separate, later, unscoped decision.
 */
export type TaskDeltaKind = "added" | "removed" | "frequency_changed";

export interface TaskDelta {
  taskId: string;
  kind: TaskDeltaKind;
  /** Kind-specific payload — a snapshot of the added task's own fields
   *  for "added" (there's no "before" to diff against), `{ from, to }`
   *  for "frequency_changed", `null` for "removed" (the id + template_id
   *  this gets stored alongside is the whole fact). */
  detail: Record<string, unknown> | null;
}

/**
 * Structural diff between two task-list snapshots, by id. Used for every
 * edit surface that submits a full before/after list (today: the one
 * generation-time customize pass, and every `/batches/:id/reassemble`
 * call) — deliberately generic rather than re-deriving from
 * CustomizationLog's already-computed fields, so the same function
 * covers both without caring how the "after" list was produced.
 */
export function diffTaskLists(before: readonly Task[], after: readonly Task[]): TaskDelta[] {
  const beforeById = new Map(before.map((t) => [t.id, t]));
  const afterById = new Map(after.map((t) => [t.id, t]));
  const deltas: TaskDelta[] = [];

  for (const t of after) {
    if (!beforeById.has(t.id)) {
      deltas.push({
        taskId: t.id,
        kind: "added",
        detail: {
          text: t.text,
          agentType: t.agentType,
          teamHint: t.teamHint,
          frequency: t.frequency,
          tier: t.tier,
          autonomy: t.autonomy,
          handsTool: t.handsTool,
          origin: t.origin,
        },
      });
    }
  }

  for (const t of before) {
    if (!afterById.has(t.id)) {
      deltas.push({ taskId: t.id, kind: "removed", detail: null });
    }
  }

  for (const t of after) {
    const prev = beforeById.get(t.id);
    if (prev && prev.frequency !== t.frequency) {
      deltas.push({ taskId: t.id, kind: "frequency_changed", detail: { from: prev.frequency, to: t.frequency } });
    }
  }

  return deltas;
}

/**
 * The generation-time case doesn't need diffTaskLists at all — the
 * customize pass already computed exactly this (pipeline.ts's
 * addedTasks/removedSet/frequencyAdjustmentsLog), and CustomizationLog
 * is that computation's own persisted shape. This is a pure re-mapping
 * to the same TaskDelta shape reassemble produces, so both sources land
 * in one consistent, chronological log rather than two different ones.
 * addedTaskDetail is looked up from `after` (the final task list) since
 * CustomizationLog.added is only ids — the actual added Task objects
 * live in the chart's own `tasks`, not in the log.
 */
export function customizationLogToDeltas(log: CustomizationLog, after: readonly Task[]): TaskDelta[] {
  const afterById = new Map(after.map((t) => [t.id, t]));
  const deltas: TaskDelta[] = [];

  for (const taskId of log.added) {
    const t = afterById.get(taskId);
    if (!t) continue; // shouldn't happen — an added id not present in the final chart
    deltas.push({
      taskId,
      kind: "added",
      detail: {
        text: t.text,
        agentType: t.agentType,
        teamHint: t.teamHint,
        frequency: t.frequency,
        tier: t.tier,
        autonomy: t.autonomy,
        handsTool: t.handsTool,
        origin: t.origin,
      },
    });
  }

  for (const taskId of log.removed) {
    deltas.push({ taskId, kind: "removed", detail: null });
  }

  for (const adj of log.frequencyAdjustments) {
    deltas.push({ taskId: adj.taskId, kind: "frequency_changed", detail: { from: adj.from, to: adj.to } });
  }

  return deltas;
}
