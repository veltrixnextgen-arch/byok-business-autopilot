import type { OrgChart } from "@byok/contracts";
import { clampCadenceToFloor, type DesiredScheduledJob } from "@byok/jobs";

export interface ClampNote {
  taskId: string;
  reason: string;
}

export interface ScheduledDispatchPayload {
  tenantId: string;
  agentId: string;
  taskId: string;
}

export interface DesiredScheduleResult {
  desired: DesiredScheduledJob[];
  /** Surfaced to the UI (plan §7: "a visible upgrade path, not a silent
   *  degradation") — every task whose declared cadence got clamped to the
   *  tenant's tier floor, and why. */
  clampNotes: ClampNote[];
}

/**
 * The tenant's desired schedule, computed fresh from its active Charter's
 * cascade + claimed org chart — never stored as its own source of truth
 * (BullMQ's own repeatable-job registry is; see tenantScheduler.ts). Only
 * tasks whose `triggerType` is `"cadence"` are ever scheduled here — R3
 * ships cadence triggers only (plan §3a); event/threshold triggers (R6/R7)
 * aren't dispatched by this path at all.
 *
 * A task with no owning agent (shouldn't happen for an assembled org
 * chart, but never assumed) is simply skipped, not scheduled with a
 * missing dispatch target.
 */
export function computeDesiredSchedule(tenantId: string, chart: OrgChart): DesiredScheduleResult {
  const desired: DesiredScheduledJob[] = [];
  const clampNotes: ClampNote[] = [];

  const agentByTaskId = new Map<string, (typeof chart.agents)[number]>();
  for (const agent of chart.agents) {
    for (const taskId of agent.taskIds) agentByTaskId.set(taskId, agent);
  }

  for (const task of chart.tasks) {
    if (task.triggerType !== "cadence" || !task.cadence) continue;
    const agent = agentByTaskId.get(task.id);
    if (!agent) continue; // no owning agent — nothing to dispatch as

    const clamp = clampCadenceToFloor(task.cadence);
    if (clamp.clamped && clamp.reason) clampNotes.push({ taskId: task.id, reason: clamp.reason });

    const payload: ScheduledDispatchPayload = { tenantId, agentId: agent.id, taskId: task.id };
    desired.push({
      jobSchedulerId: `${tenantId}:${agent.id}:${task.id}`,
      cadence: clamp.cadence,
      payload: payload as unknown as Record<string, unknown>,
    });
  }

  return { desired, clampNotes };
}
