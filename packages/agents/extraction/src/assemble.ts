import type { AutonomyDefault, TeamHint, Tier } from "@byok/templates";
import type { ApiCallUsage, CustomizationLog, OrgChart, OrgChartSubAgent, OrgChartTask, OrgChartTeam, TemplateSelection } from "./types.js";

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
  delivery: "Delivery Lead",
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

export class HandsScopeViolationError extends Error {}
export class ComplianceMetadataError extends Error {}

// Hard invariant: every compliance-category task must carry
// requiresProfessionalVerification: true. Compliance sub-agents flag for a
// human professional and never advise autonomously (Part 2) — this field is
// the machine-checkable version of that rule, and downstream UI relies on
// it to show the "review with your professional" banner. A missing/false
// value here is a bug in the template or the customize pass, not a style nit.
function validateComplianceMetadata(tasks: OrgChartTask[]): void {
  const violations = tasks.filter((t) => t.teamHint === "compliance" && t.requiresProfessionalVerification !== true);
  if (violations.length > 0) {
    throw new ComplianceMetadataError(
      `Compliance task(s) missing requiresProfessionalVerification: true: ${violations.map((t) => t.id).join(", ")}.`,
    );
  }
}

// Hard invariant, not a lint warning: a Hands tool identifier used for the
// business's OWN back-office access (cfo team) must never be the same
// identifier used for CLIENT-scoped access (delivery team). Sharing a
// literal handsTool string across those two teams would mean the same
// credential/connection covers both the business's own books and a
// client's — exactly the cross-tenant leak the vault's per-sub-agent,
// just-in-time Hands scoping (ADR-002) exists to prevent.
function validateHandsScopeSeparation(subAgents: OrgChartSubAgent[]): void {
  const cfoTools = new Set(subAgents.filter((s) => s.teamId === "cfo").flatMap((s) => s.handsTools));
  const deliveryTools = new Set(subAgents.filter((s) => s.teamId === "delivery").flatMap((s) => s.handsTools));

  const shared = [...cfoTools].filter((tool) => deliveryTools.has(tool));
  if (shared.length > 0) {
    throw new HandsScopeViolationError(
      `Hands tool(s) shared between CFO (own-backoffice) and Delivery (client-facing) sub-agents: ` +
        `${shared.join(", ")}. Give the delivery-scoped task a distinct handsTool identifier ` +
        `(e.g. "X (client-scoped, per-client OAuth)") — these scopes must never overlap.`,
    );
  }
}

export function assembleOrgChart(
  idea: string,
  templateSelection: TemplateSelection,
  tasks: OrgChartTask[],
  customization: CustomizationLog,
  calls: ApiCallUsage[],
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

  validateHandsScopeSeparation(subAgents);
  validateComplianceMetadata(tasks);

  return {
    meta: {
      idea,
      generatedAt: new Date().toISOString(),
      templateSelection,
      calls,
      costUsd: calls.reduce((sum, c) => sum + c.costUsd, 0),
    },
    teams,
    subAgents,
    tasks,
    customization,
    onboardingBatch: null, // filled in by pipeline.ts once the chart is final
  };
}
