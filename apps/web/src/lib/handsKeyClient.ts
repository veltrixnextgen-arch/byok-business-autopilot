import { API_URL, apiClient } from "./apiClient";

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

/**
 * Builds the plain <a href> URL for an "oauth-live" tool's real connect
 * flow (PR 2B) — a top-level browser navigation to apps/api's
 * /hands-oauth/:service/start, never a fetch() (it needs to leave the
 * page for the provider's consent screen and come back). Uses the SAME
 * capabilityScopeForTool(tool) as the paste-a-key path above, not
 * something derived from oauthService — the org chart's later status
 * check (getHandsKeyStatus) looks up by tool, not by which auth method
 * connected it, and both paths must resolve to the identical
 * (subAgentId, capabilityScope) pair or a successful OAuth connect would
 * never show as connected in the UI.
 */
export function handsOAuthStartUrl(subAgentId: string, tool: string, oauthService: string): string {
  const params = new URLSearchParams({ subAgentId, capabilityScope: capabilityScopeForTool(tool) });
  return `${API_URL}/api/hands-oauth/${oauthService}/start?${params.toString()}`;
}
