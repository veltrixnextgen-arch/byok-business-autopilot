import { cadenceToRepeatOptions } from "./cadenceSchedule.js";
import type { Cadence } from "@byok/contracts";

/** One task that should have a standing repeatable job. `jobSchedulerId` is
 *  the BullMQ Job Scheduler id — stable across resyncs, and built by the
 *  caller as `${tenantId}:${agentId}:${taskId}` so removal can be scoped
 *  correctly per tenant. */
export interface DesiredScheduledJob {
  jobSchedulerId: string;
  cadence: Cadence;
  payload: Record<string, unknown>;
}

export interface JobSchedulerDescriptor {
  id?: string | null;
  every?: number;
  pattern?: string;
}

/** Structural subset of BullMQ's real `Queue`'s Job Scheduler API (BullMQ
 *  6.x — `upsertJobScheduler`/`getJobSchedulers`/`removeJobScheduler`,
 *  superseding the older `add({repeat})`/`getRepeatableJobs`/
 *  `removeRepeatableByKey` API this file used before). A real Queue
 *  instance satisfies this as-is — same pattern as queue.ts's
 *  `QueueLike<Payload>`, so this stays fully testable without a live
 *  Redis connection. */
export interface RepeatableQueueLike {
  upsertJobScheduler(
    jobSchedulerId: string,
    repeatOpts: { every: number } | { pattern: string },
    jobTemplate?: { data?: unknown },
  ): Promise<unknown>;
  getJobSchedulers(): Promise<JobSchedulerDescriptor[]>;
  removeJobScheduler(jobSchedulerId: string): Promise<boolean>;
}

export interface SyncResult {
  added: string[];
  removed: string[];
  unchanged: string[];
}

function sameSchedule(current: JobSchedulerDescriptor, desired: { every: number } | { pattern: string }): boolean {
  if ("every" in desired) return current.every === desired.every;
  return current.pattern === desired.pattern;
}

/**
 * Reconciles a tenant's desired schedule (computed by the caller from the
 * tenant's active Charter + org chart, already clamped to the tier floor
 * — see cadenceFloors.ts) against what's actually registered in BullMQ.
 * Scoped to ONE tenant at a time: only Job Schedulers whose id starts with
 * `${tenantId}:` are ever touched, so syncing tenant A's schedule can
 * never remove tenant B's jobs even if they share a queue.
 *
 * `upsertJobScheduler` is itself idempotent (create-or-update in one
 * call), so this never has to manually diff "same id, changed interval"
 * out into a separate remove+add step the way the older repeatable-jobs
 * API required — BullMQ does that atomically. The before/after comparison
 * here exists purely to report what changed, for the sync route's
 * response (plan §7: clamped/changed schedules should be visible, not
 * silent).
 */
export async function syncTenantSchedule(
  queue: RepeatableQueueLike,
  jobName: string,
  tenantId: string,
  desired: readonly DesiredScheduledJob[],
): Promise<SyncResult> {
  const existing = (await queue.getJobSchedulers()).filter((j) => j.id?.startsWith(`${tenantId}:`));
  const existingById = new Map(existing.map((j) => [j.id!, j]));
  const desiredIds = new Set(desired.map((d) => d.jobSchedulerId));

  const added: string[] = [];
  const unchanged: string[] = [];
  for (const job of desired) {
    const repeatOptions = cadenceToRepeatOptions(job.cadence);
    const current = existingById.get(job.jobSchedulerId);
    if (current && sameSchedule(current, repeatOptions)) {
      unchanged.push(job.jobSchedulerId);
      continue;
    }
    await queue.upsertJobScheduler(job.jobSchedulerId, repeatOptions, { data: job.payload });
    added.push(job.jobSchedulerId);
  }

  const removed: string[] = [];
  for (const job of existing) {
    if (job.id && !desiredIds.has(job.id)) {
      await queue.removeJobScheduler(job.id);
      removed.push(job.id);
    }
  }

  return { added, removed, unchanged };
}
