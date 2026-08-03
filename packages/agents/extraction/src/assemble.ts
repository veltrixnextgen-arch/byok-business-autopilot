import type { AutonomyDefault, TeamHint, Tier } from "@byok/templates";
import type { Agent, ApiCallUsage, CustomizationLog, OrgChart, Task, Team, TemplateSelection } from "./types.js";

// ADR-001: assembly order is strict — tasks -> agents -> teams -> roles.
// Clustering here is "emergent" in the sense that clusters are computed from
// task metadata (agentType, teamHint) that each task already carries,
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
// Most restrictive wins when summarizing an agent's default: a team lead
// reviewing "what can this agent do unsupervised" should see the
// cautious answer, matching the fail-closed spirit of the cost gate.
const AUTONOMY_RANK: Record<AutonomyDefault, number> = { locked: 0, earnable: 1, "eligible-early": 2 };

function mostRestrictiveTier(tasks: Task[]): Tier {
  return tasks.reduce((max, t) => (TIER_RANK[t.tier] > TIER_RANK[max] ? t.tier : max), "T1" as Tier);
}

function mostRestrictiveAutonomy(tasks: Task[]): AutonomyDefault {
  return tasks.reduce(
    (min, t) => (AUTONOMY_RANK[t.autonomy] < AUTONOMY_RANK[min] ? t.autonomy : min),
    "eligible-early" as AutonomyDefault,
  );
}

// A curated first-name bank for Agent.name (docs/product/userflow-v2.md
// Stage 2: "Name — auto-suggested, fully editable... Priya · Invoicing,
// Sam · Expenses"). Deterministic, not an LLM call: this is a cheap,
// synchronous assembly step, and every agent needs a name whether or not
// the (budget-gated, LLM-driven) onboarding batch runs at all. Picking a
// real per-role name (why "Alex" fits a CFO) is exactly the kind of
// product decision this contract refuses to fabricate — this bank makes
// no such claim, it just needs to be a stable, collision-free label.
const NAME_BANK = [
  "Alex", "Priya", "Sam", "Maya", "Riko", "Devon", "Jordan", "Casey", "Morgan", "Taylor",
  "Noor", "Kai", "Zara", "Leo", "Ana", "Theo", "Yuki", "Omar", "Grace", "Iris",
  "Felix", "Nadia", "Miles", "Sana", "Owen", "Ivy", "Dara", "Finn", "Rosa", "Kian",
  "Wren", "Amir", "Lena", "Cole", "Mira", "Beau", "Tess", "Rhys", "Nia", "Jules",
];

// Deterministic (same agentType always maps to the same starting index, so
// re-running extraction on an unchanged task list produces a stable org
// chart), with linear-probing collision avoidance so no two agents in the
// same chart share a name.
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function assignAgentNames(agentTypes: string[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const agentType of agentTypes) {
    let idx = hashString(agentType) % NAME_BANK.length;
    for (let attempt = 0; attempt < NAME_BANK.length; attempt++) {
      const candidate = NAME_BANK[(idx + attempt) % NAME_BANK.length];
      if (!used.has(candidate)) {
        used.add(candidate);
        names.set(agentType, candidate);
        break;
      }
    }
    // Falls through with no name only if agentTypes.length > NAME_BANK.length
    // (40 distinct task clusters in one chart) — not reachable with today's
    // templates, and a missing name would be a loud, visible bug (blank
    // "· Invoicing" card) rather than a silent one.
  }
  return names;
}

export class HandsScopeViolationError extends Error {}
export class ComplianceMetadataError extends Error {}

// Hard invariant: every compliance-category task must carry
// requiresProfessionalVerification: true. Compliance agents flag for a
// human professional and never advise autonomously (Part 2) — this field is
// the machine-checkable version of that rule, and downstream UI relies on
// it to show the "review with your professional" banner. A missing/false
// value here is a bug in the template or the customize pass, not a style nit.
function validateComplianceMetadata(tasks: Task[]): void {
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
// client's — exactly the cross-tenant leak the vault's per-agent,
// just-in-time Hands scoping (ADR-002) exists to prevent.
function validateHandsScopeSeparation(agents: Agent[]): void {
  const cfoTools = new Set(agents.filter((a) => a.teamId === "cfo").flatMap((a) => a.hands));
  const deliveryTools = new Set(agents.filter((a) => a.teamId === "delivery").flatMap((a) => a.hands));

  const shared = [...cfoTools].filter((tool) => deliveryTools.has(tool));
  if (shared.length > 0) {
    throw new HandsScopeViolationError(
      `Hands tool(s) shared between CFO (own-backoffice) and Delivery (client-facing) agents: ` +
        `${shared.join(", ")}. Give the delivery-scoped task a distinct handsTool identifier ` +
        `(e.g. "X (client-scoped, per-client OAuth)") — these scopes must never overlap.`,
    );
  }
}

export function assembleOrgChart(
  idea: string,
  templateSelection: TemplateSelection,
  tasks: Task[],
  customization: CustomizationLog,
  calls: ApiCallUsage[],
): OrgChart {
  // 1. Cluster tasks into agents by agentType (one agent per task type).
  const byAgentType = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = byAgentType.get(task.agentType) ?? [];
    list.push(task);
    byAgentType.set(task.agentType, list);
  }

  // 2. Determine which teams exist among non-compliance agents, so a
  //    compliance agent can attach to CFO (preferred) or Ops instead of
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

  const agentNames = assignAgentNames([...byAgentType.keys()]);

  const agents: Agent[] = [];
  for (const [agentType, agentTasks] of byAgentType) {
    const rawTeamHint = agentTasks[0].teamHint;
    const teamId = rawTeamHint === "compliance" ? complianceAttachesTo : rawTeamHint;
    const requiresProfessionalVerification = agentTasks.some((t) => t.requiresProfessionalVerification === true);
    const autonomyDefault = mostRestrictiveAutonomy(agentTasks);

    agents.push({
      id: agentType,
      name: agentNames.get(agentType)!,
      title: agentTasks[0].agentLabel,
      teamId,
      taskIds: agentTasks.map((t) => t.id),
      tier: mostRestrictiveTier(agentTasks),
      // No real per-role Brain recommendation exists yet (which provider,
      // and why, is a product decision nobody has made) — null is the
      // honest value, not a stand-in for one that hasn't been computed.
      brain: null,
      hands: [...new Set(agentTasks.map((t) => t.handsTool).filter((h): h is string => h !== null))],
      autonomyDefault,
      complianceLocked: autonomyDefault === "locked",
      requiresProfessionalVerification,
    });
  }

  // 3. Group agents into teams, each led by the role from the catalog.
  const byTeam = new Map<TeamHint, Agent[]>();
  for (const agent of agents) {
    const list = byTeam.get(agent.teamId) ?? [];
    list.push(agent);
    byTeam.set(agent.teamId, list);
  }

  const teams: Team[] = [...byTeam.entries()].map(([teamId, teamAgents]) => ({
    id: teamId,
    roleTitle: ROLE_TITLES[teamId],
    isHuman: teamId === "founder",
    agentIds: teamAgents.map((a) => a.id),
  }));

  validateHandsScopeSeparation(agents);
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
    agents,
    tasks,
    customization,
    onboardingBatch: null, // filled in by pipeline.ts once the chart is final
  };
}
