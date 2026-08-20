import { apiClient } from "./apiClient";

export interface DigestAgentActivity {
  agentId: string;
  agentName: string;
  taskCount: number;
  spentUsd: number;
}

export interface Digest {
  tenantId: string;
  date: string;
  agentActivity: DigestAgentActivity[];
  pendingApprovalCount: number;
  spentUsd: number;
  ceilingUsd: number;
}

export async function getDigest(): Promise<Digest | null> {
  const res = await apiClient.me.digest.$get();
  if (!res.ok) throw new Error(`Could not load today's digest (${res.status}).`);
  const { digest } = await res.json();
  return digest as Digest | null;
}
