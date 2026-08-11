import { apiClient } from "./apiClient";

export interface HandsKeyStatus {
  id: string;
  service: string;
  maskedFingerprint: string;
  createdAt: string;
}

/**
 * Hands keys are per (subAgentId, capabilityScope), not one company-wide
 * choice like a v1 Brain key — see apps/api's handsKeys.ts. The org chart
 * (Agent.hands: string[]) only names WHICH tools an agent needs, not a
 * granular capability scope (that's real product surface nobody has
 * built yet — packages/agents/extraction doesn't emit one). Until it
 * does, this is the one-scope-per-tool placeholder convention every
 * caller in this file uses consistently — store and status-check always
 * agree on the same derived string, which is all Vault's AAD binding
 * actually requires.
 */
export function capabilityScopeForTool(tool: string): string {
  return tool.toLowerCase();
}

export async function getHandsKeyStatus(subAgentId: string, tool: string): Promise<HandsKeyStatus | null> {
  const res = await apiClient.me["hands-keys"].$get({
    query: { subAgentId, capabilityScope: capabilityScopeForTool(tool) },
  });
  if (!res.ok) throw new Error(`Could not check "${tool}" connection status (${res.status}).`);
  const { key } = await res.json();
  return key as HandsKeyStatus | null;
}

export async function connectHandsKey(subAgentId: string, tool: string, apiKey: string): Promise<HandsKeyStatus> {
  const res = await apiClient.me["hands-keys"].$post({
    json: { subAgentId, capabilityScope: capabilityScopeForTool(tool), service: tool, apiKey },
  });
  if (!res.ok) throw new Error(`Could not connect "${tool}" (${res.status}).`);
  const { key } = await res.json();
  return key as HandsKeyStatus;
}
