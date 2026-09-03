import type { AutonomyDefault, BusinessTemplateId, Cadence, Frequency, HandsScope, Stakes, TeamHint, Tier, TriggerType } from "./primitives.js";
import type { OnboardingBatch } from "./charter.js";

// ADR-013: this file is the single source of truth for what extraction
// produces and what apps/web consumes — apps/web imports these types and
// never redefines the shape itself. A UI screen that needs a field the
// engine doesn't emit is a signal to change the engine (packages/agents/
// extraction), not to invent the field here or in apps/web.

/**
 * Brain = the LLM that does an Agent's thinking (Claude, ChatGPT, Gemini,
 * DeepSeek...), recommended per agent with a plain-language reason
 * (docs/product/userflow-v2.md Stage 2, "The Brain"). Distinct from `tier`:
 * tier is the cost/capability class this agent needs (T1/T2/T3), brain is
 * the specific provider recommended for it.
 *
 * Extraction does not yet compute a real recommendation — which provider,
 * and why, is a real product decision nobody has made yet — so
 * Agent.brain is `null` until that logic exists. A null brain is a
 * complete, honest state, not a stub: it means "no recommendation yet",
 * and the UI must show that plainly rather than inventing one.
 */
export interface BrainRecommendation {
  provider: string;
  reason: string;
}

/**
 * Runwisely master vision §12 Phase A item 1: this platform-wide default,
 * derived from `tier`, populates CostGate's real per-agent daily ceiling
 * (apps/api's trust-core wiring reads it off each agent — see
 * DEFAULT_PER_AGENT_PER_DAY_USD, apps/api/src/routes/ceiling.ts, for the
 * flat fallback used where no agent entry applies). These are NOT informed
 * per-agent values — nothing has ever measured what a real agent at a given
 * tier actually costs per day — they're a tier-aware refinement of the same
 * "generous safety net, not a tight budget" backstop, roughly proportional
 * to the real per-token cost ratio between tiers in
 * packages/cost-gate/src/pricing-table.json's Anthropic entries (T2 is
 * ~3.75x T1, T3 is ~5x T2). A genuinely per-agent-authored value would
 * replace this lookup entirely; until one exists, every agent at a given
 * tier shares the same number.
 */
export const TIER_DEFAULT_BUDGET_PER_DAY_USD: Record<Tier, number> = {
  T1: 2,
  T2: 5,
  T3: 15,
};

export interface AgentBudget {
  perDayUsd: number;
  /** Always "tier-default" today — see TIER_DEFAULT_BUDGET_PER_DAY_USD's
   *  own comment. Named explicitly so nothing downstream (a UI label, a
   *  future export) can present this as a number anyone actually chose. */
  source: "tier-default";
}

/** Team LEAD roles are not modeled as Agents yet (see this file's own
 *  Agent doc comment) — for now this is just the agent's own team plus
 *  that team's roleTitle from the role catalog, not a link to a real
 *  managing Agent. Upgrade this to reference a real lead Agent if/when
 *  team leads themselves become Agents. */
export interface ReportingStructure {
  teamId: TeamHint;
  teamRoleTitle: string;
}

/**
 * The atomic AI worker in the org chart (userflow-v2.md Stage 2's "Priya ·
 * Invoicing", "Sam · Expenses") — one per distinct task cluster. Team LEAD
 * roles (e.g. "Alex · CFO") are not modeled as Agents yet; today they're
 * just Team.roleTitle, a plain string. Promoting a team lead to a named,
 * Brain-having Agent of its own is real product surface (Stage 2 role
 * cards) that hasn't been built — add it to the engine when that's built,
 * not by inventing it in the UI.
 */
export interface Agent {
  id: string;
  /** Auto-suggested, deterministic for a given org chart — editable
   *  downstream (that mutation is a future UI concern, not this
   *  contract's). */
  name: string;
  /** The agent's specific function, permanently pinned beneath its name
   *  everywhere downstream ("Priya · Invoicing"). */
  title: string;
  /** Derived, not authored or LLM-generated — the plain-language join of
   *  this agent's own task descriptions (assemble.ts's deriveObjective).
   *  Honest rather than fabricated: no per-role description exists
   *  anywhere in the template catalog to draw from (only the short
   *  `title`/agentLabel), and authoring one for every agentType across six
   *  templates plus every customize-added invention is real content work,
   *  not something this contract should invent unilaterally. */
  objective: string;
  teamId: TeamHint;
  taskIds: string[];
  tier: Tier;
  brain: BrainRecommendation | null;
  /** Service-tool names this agent's tasks will need, connected later,
   *  just-in-time (Stage 3, BYOK). Informational only until then. */
  hands: string[];
  /** See AgentBudget's own comment — a tier-derived default, not a value
   *  anyone chose for this specific agent. */
  budget: AgentBudget;
  reportingStructure: ReportingStructure;
  autonomyDefault: AutonomyDefault;
  /** North star doc Tier 1 item 4: the risk-tiered framing for what this
   *  agent can do unsupervised, shown to the founder as "Low/Medium/High"
   *  rather than the flat locked/earnable/eligible-early split
   *  `autonomyDefault` itself still drives internally (cascade.ts's system
   *  prompt, the CLI tree printer). Derived from the most restrictive
   *  `Stakes` among this agent's own tasks (assemble.ts's
   *  mostRestrictiveStakes) — the same real per-task metadata the deny-list
   *  gate (packages/approval-queue) already keys off, not a new invented
   *  classification. */
  riskTier: Stakes;
  /** True when this agent cannot be granted autonomy without a licensed
   *  professional's sign-off — always equal to requiresProfessionalVerification
   *  below (a UI-friendly name for the same fact, not a derived/different
   *  one). NOT derived from autonomyDefault === "locked": plenty of tasks
   *  are locked for caution unrelated to compliance (a deploy-coordinator
   *  where "the human approves every production deploy, always", a
   *  vendor-manager where "ordering never autonomous") — confirmed for
   *  real running the six fixtures, where that derivation produced a
   *  tax-deadline-tracker agent with complianceLocked: true and
   *  requiresProfessionalVerification: false, exactly backwards. */
  complianceLocked: boolean;
  /** True when at least one of this agent's tasks requires professional
   *  verification — the compliance-category invariant assemble.ts's
   *  validateComplianceMetadata enforces at the task level, surfaced here
   *  at the agent level so the UI doesn't need to inspect individual
   *  tasks to know whether to show the "review with your professional"
   *  banner. */
  requiresProfessionalVerification: boolean;
}

export interface Team {
  id: TeamHint;
  roleTitle: string;
  isHuman: boolean;
  agentIds: string[];
}

export interface Task {
  id: string;
  text: string;
  agentType: string;
  agentLabel: string;
  teamHint: TeamHint;
  frequency: Frequency;
  stakes: Stakes;
  tier: Tier;
  autonomy: AutonomyDefault;
  autonomyNote?: string;
  handsTool: string | null;
  handsScope?: HandsScope;
  /** MANDATORY true whenever teamHint === "compliance" — hard invariant,
   *  enforced in assemble.ts. See TemplateTask (@byok/templates) for the
   *  full rationale. */
  requiresProfessionalVerification?: boolean;
  origin: "template" | "customize-added";
  /** R1/R3 scheduling metadata (docs/architecture/automation-runtime-plan.md
   *  §3, ADR-026). For "template"-origin tasks this flows straight through
   *  from the template's own TemplateTask fields. For "customize-added"
   *  tasks (the customize LLM's own invention, with no template to inherit
   *  from) it's derived deterministically from `frequency`/`agentType` —
   *  see pipeline.ts's `deriveScheduleMetadata` — never a second LLM call.
   *  R3's scheduler is the first real consumer: it only ever schedules a
   *  repeatable job for a task whose `triggerType` is `"cadence"`. */
  cadence: Cadence | null;
  batchable: boolean;
  triggerType: TriggerType;
}

export interface TemplateSelection {
  primary: BusinessTemplateId;
  blendedWith: BusinessTemplateId | null;
  scores: Record<BusinessTemplateId, number>;
  /** True when the top two scores were exactly equal — selection used the
   *  explicit tiebreak priority, not a clean win. Surfaced so callers/
   *  reports can flag genuinely ambiguous ideas instead of hiding it. */
  tie: boolean;
  /** "low" whenever blendedWith is set or tie is true — the top two
   *  candidates are close enough that the primary pick is closer to a
   *  guess than a decision (the makerspace/meal-prep case). Callers that
   *  ask the founder to disambiguate (see extraction.ts's /questions
   *  route) key off this rather than re-deriving it from tie/blendedWith
   *  themselves. */
  confidence: "high" | "low";
}

export interface CategoryCorrection {
  taskId: string;
  from: TeamHint;
  to: TeamHint;
  reason: string;
}

export interface CustomizationLog {
  added: string[];
  removed: string[];
  frequencyAdjustments: { taskId: string; from: Frequency; to: Frequency }[];
  categoryCorrections: CategoryCorrection[];
  notes?: string;
}

export interface ApiCallUsage {
  step: "customize" | "category-validate" | "onboarding-batch";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface OrgChart {
  meta: {
    idea: string;
    generatedAt: string;
    templateSelection: TemplateSelection;
    calls: ApiCallUsage[];
    costUsd: number; // sum of calls[].costUsd — the real per-signup CAC
  };
  teams: Team[];
  agents: Agent[];
  tasks: Task[];
  customization: CustomizationLog;
  /** null only if generation was skipped after a budget/transient failure
   *  (see packages/agents/extraction/src/onboardingBatch.ts) — the org
   *  chart itself is still valid. */
  onboardingBatch: OnboardingBatch | null;
}

const STAKES_RANK: Record<Stakes, number> = { low: 0, medium: 1, high: 2 };

/** The most restrictive Stakes among a set of tasks — shared by
 *  assemble.ts (fresh extraction) and normalizeOrgChart below (backfilling
 *  a stored chart older than Agent.riskTier existed). */
export function mostRestrictiveStakes(tasks: Task[]): Stakes {
  return tasks.reduce((max, t) => (STAKES_RANK[t.stakes] > STAKES_RANK[max] ? t.stakes : max), "low" as Stakes);
}

/**
 * Migration-on-read for a stored org chart — the systemic fix for JSONB
 * schema drift (docs/STATUS.md's "JSONB schema drift" issue, found via
 * PR #213: `signup_extraction_batches.org_chart` is a frozen snapshot, and
 * a chart captured before a contract field existed has that field simply
 * absent, not null — `agent.budget`/`agent.riskTier` on every real tenant's
 * chart predating 2026-09-02 were exactly this).
 *
 * `SignupExtractionBatchStore.rowToBatch` (packages/db) runs every stored
 * chart through this on read, so the next field the Agent/Task contract
 * gains only needs a default added HERE, once, instead of hunted down
 * across every consumer (apps/api routes, apps/web screens, worker
 * dispatch) the way budget/riskTier had to be this time. A freshly
 * assembled chart (assembleOrgChart) never needs this — it's never
 * missing a field its own contract defines.
 */
export function normalizeOrgChart(chart: OrgChart): OrgChart {
  return {
    ...chart,
    agents: chart.agents.map((agent) => {
      if (agent.budget !== undefined && agent.riskTier !== undefined) return agent;
      const agentTasks = chart.tasks.filter((t) => agent.taskIds.includes(t.id));
      return {
        ...agent,
        budget: agent.budget ?? { perDayUsd: TIER_DEFAULT_BUDGET_PER_DAY_USD[agent.tier], source: "tier-default" },
        riskTier: agent.riskTier ?? mostRestrictiveStakes(agentTasks),
      };
    }),
  };
}
