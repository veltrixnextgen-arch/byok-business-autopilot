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
