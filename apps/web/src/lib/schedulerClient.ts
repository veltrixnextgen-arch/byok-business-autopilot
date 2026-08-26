import { apiClient } from "./apiClient";

export interface SchedulerStatus {
  paused: boolean;
  pausedAt: string | null;
  pausedReason: string | null;
  remainingTaskCount: number | null;
  ceilingUsd: number | null;
  spentUsd: number | null;
}

export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  const res = await apiClient.me.scheduler.status.$get();
  if (!res.ok) throw new Error(`Could not check your automation status (${res.status}).`);
  return res.json();
}

export async function resumeSchedule(): Promise<void> {
  const res = await apiClient.me.scheduler.resume.$post();
  if (!res.ok) throw new Error(`Could not resume your automation (${res.status}).`);
}

/** Issue #159: no UI calls this yet — same API-first scoping as issue
 *  #141's cadence-editing route. Runs one cadence-triggered task through
 *  the real dispatch path immediately, instead of waiting for its next
 *  tick. */
export class RunNowThrottledError extends Error {}

export async function runTaskNow(taskId: string): Promise<{ enqueued: true; taskId: string; agentId: string }> {
  const res = await apiClient.me.scheduler["run-now"].$post({ json: { taskId } });
  if (res.status === 429) {
    const { error } = (await res.json()) as { error: string };
    throw new RunNowThrottledError(error);
  }
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({ error: undefined }))) as { error?: string };
    throw new Error(error ?? `Could not run that task now (${res.status}).`);
  }
  return res.json();
}
