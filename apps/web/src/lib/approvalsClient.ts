import { apiClient } from "./apiClient";

export interface ApprovalItem {
  id: string;
  kind: "action" | "recommendation";
  agentName: string;
  roleTitle: string;
  taskType: string | null;
  title: string;
  output: string;
  effectDescription: string | null;
  stakesTags: string[];
  neverEarnsAutonomy: boolean;
  costUsd: number | null;
  createdAt: string;
}

export interface AutonomyStatusEntry {
  taskType: string;
  active: boolean;
  consecutiveApprovals: number;
  offeredAt: string | null;
}

export interface ApprovalsView {
  items: ApprovalItem[];
  autonomyStatus: AutonomyStatusEntry[];
}

export type Verdict = { kind: "APPROVE" } | { kind: "REJECT"; feedback: string } | { kind: "MODIFY"; editedOutput: string };

export async function getApprovals(): Promise<ApprovalsView> {
  const res = await apiClient.me.approvals.$get();
  if (!res.ok) throw new Error(`Could not load your approvals queue (${res.status}).`);
  return res.json();
}

export async function getApprovalsCount(): Promise<number> {
  const res = await apiClient.me.approvals.count.$get();
  if (!res.ok) throw new Error(`Could not load your approvals count (${res.status}).`);
  const { count } = await res.json();
  return count;
}

export async function resolveApproval(
  id: string,
  kind: "action" | "recommendation",
  verdict: Verdict,
): Promise<{ resolved: boolean; dispatched: boolean }> {
  const res = await apiClient.me.approvals[":id"].resolve.$post({ param: { id }, json: { kind, verdict } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not resolve this item (${res.status}).`);
  }
  return res.json();
}

export async function acceptAutonomyOffer(taskType: string): Promise<void> {
  const res = await apiClient.me.approvals.autonomy[":taskType"].accept.$post({ param: { taskType } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not accept this offer (${res.status}).`);
  }
}
