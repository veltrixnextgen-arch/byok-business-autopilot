import type { AutonomyDefault, TeamHint, Tier } from "@byok/templates";
import type { CustomizationLog, OrgChart, OrgChartSubAgent, OrgChartTask, OrgChartTeam, TemplateSelection } from "./types.js";

// ADR-001: assembly order is strict — tasks -> sub-agents -> teams -> roles.
// Clustering here is "emergent" in the sense that clusters are computed from
// task metadata (subAgentType, teamHint) that each task already carries,
// rather than a hardcoded org chart keyed by business type — swap the task
// list and the org chart that falls out changes with it.

const ROLE_TITLES: Record<TeamHint, string> = {
  founder: "Founder / CEO",
  cfo: "CFO",
  cmo: "CMO",
  support: "Support Lead",
  sales: "Sales Lead",
  ops: "Ops Lead",
  compliance: "Compliance",
  people: "People Lead",
  "product-dev": "Product/Dev Lead",
};

const TIER_RANK: Record<Tier, number> = { T1: 1, T2: 2, T3: 3 };
// Most restrictive wins when summarizing a sub-agent's default: a team lead
// reviewing "what can this sub-agent do unsupervised" should see the
// cautious answer, matching the fail-closed spirit of the cost gate.
const AUTONOMY_RANK: Record<AutonomyDefault, number> = { locked: 0, earnable: 1, "eligible-early": 2 };

function mostRestrictiveTier(tasks: OrgChartTask[]): Tier {
  return tasks.reduce((max, t) => (TIER_RANK[t.tier] > TIER_RANK[max] ? t.tier : max), "T1" as Tier);
}

function mostRestrictiveAutonomy(tasks: OrgChartTask[]): AutonomyDefault {
  return tasks.reduce(
    (min, t) => (AUTONOMY_RANK[t.autonomy] < AUTONOMY_RANK[min] ? t.autonomy : min),
    "eligible-early" as AutonomyDefault,
  );
}

export function assembleOrgChart(
  idea: string,
  templateSelection: TemplateSelection,
  tasks: OrgChartTask[],
  customization: CustomizationLog,
  usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number },
): OrgChart {
  // 1. Cluster tasks into sub-agents by subAgentType (one sub-agent per task type).
  const bySubAgent = new Map<string, OrgChartTask[]>();
  for (const task of tasks) {
    const list = bySubAgent.get(task.subAgentType) ?? [];
    list.push(task);
    bySubAgent.set(task.subAgentType, list);
  }

  // 2. Determine which teams exist among non-compliance sub-agents, so a
  //    compliance sub-agent can attach to CFO (preferred) or Ops instead of
  //    standing up its own role (Part 2: "attaches to CFO or Ops rather
  //    than being a full role").
  const nonComplianceTeamHints = new Set<TeamHint>();
  for (const task of tasks) {
    if (task.teamHint !== "compliance") nonComplianceTeamHints.add(task.teamHint);
  }
  const complianceAttachesTo: TeamHint = nonComplianceTeamHints.has("cfo")
    ? "cfo"
    : nonComplianceTeamHints.has("ops")
      ? "ops"
      : "compliance";

  const subAgents: OrgChartSubAgent[] = [];
  const subAgentTeamId = new Map<string, TeamHint>();

  for (const [subAgentType, subTasks] of bySubAgent) {
    const rawTeamHint = subTasks[0].teamHint;
    const teamId = rawTeamHint === "compliance" ? complianceAttachesTo : rawTeamHint;
    subAgentTeamId.set(subAgentType, teamId);

    subAgents.push({
      id: subAgentType,
      label: subTasks[0].subAgentLabel,
      teamId,
      taskIds: subTasks.map((t) => t.id),
      suggestedTier: mostRestrictiveTier(subTasks),
      autonomyDefault: mostRestrictiveAutonomy(subTasks),
      handsTools: [...new Set(subTasks.map((t) => t.handsTool).filter((h): h is string => h !== null))],
    });
  }

  // 3. Group sub-agents into teams, each led by the role from the catalog.
  const byTeam = new Map<TeamHint, OrgChartSubAgent[]>();
  for (const subAgent of subAgents) {
    const list = byTeam.get(subAgent.teamId) ?? [];
    list.push(subAgent);
    byTeam.set(subAgent.teamId, list);
  }

  const teams: OrgChartTeam[] = [...byTeam.entries()].map(([teamId, teamSubAgents]) => ({
    id: teamId,
    roleTitle: ROLE_TITLES[teamId],
    isHuman: teamId === "founder",
    subAgentIds: teamSubAgents.map((s) => s.id),
  }));

  return {
    meta: {
      idea,
      generatedAt: new Date().toISOString(),
      templateSelection,
      model: usage.model,
      costUsd: usage.costUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
    teams,
    subAgents,
    tasks,
    customization,
  };
}
