import { apiClient } from "./apiClient";

export interface AgentBudgetInfo {
  agentId: string;
  name: string;
  title: string;
  perDayUsd: number;
  source: "tier-default" | "override";
}

/** North star doc Tier 1 item 3: the missing product surface for a
 *  genuinely per-agent-authored budget — same pattern as getCeiling/
 *  setCeiling (brainKeyClient.ts) for the company-wide ceiling. */
export async function getAgentBudgets(): Promise<AgentBudgetInfo[]> {
  const res = await apiClient.me["agent-budgets"].$get();
  if (!res.ok) throw new Error(`Could not load agent budgets (${res.status}).`);
  const { agents } = await res.json();
  return agents;
}

export class InvalidAgentBudgetError extends Error {}

export async function setAgentBudget(agentId: string, perDayUsd: number): Promise<void> {
  const res = await apiClient.me["agent-budgets"][":agentId"].$post({ param: { agentId }, json: { perDayUsd } });
  if (res.status === 400) {
    const { error } = (await res.json()) as { error: string };
    throw new InvalidAgentBudgetError(error);
  }
  if (!res.ok) throw new Error(`Could not save that budget (${res.status}).`);
}
