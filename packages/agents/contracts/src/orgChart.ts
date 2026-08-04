import type { AutonomyDefault, BusinessTemplateId, Frequency, HandsScope, Stakes, TeamHint, Tier } from "./primitives.js";
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
  teamId: TeamHint;
  taskIds: string[];
  tier: Tier;
  brain: BrainRecommendation | null;
  /** Service-tool names this agent's tasks will need, connected later,
   *  just-in-time (Stage 3, BYOK). Informational only until then. */
  hands: string[];
  autonomyDefault: AutonomyDefault;
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
}

export interface TemplateSelection {
  primary: BusinessTemplateId;
  blendedWith: BusinessTemplateId | null;
  scores: Record<BusinessTemplateId, number>;
  /** True when the top two scores were exactly equal — selection used the
   *  explicit tiebreak priority, not a clean win. Surfaced so callers/
   *  reports can flag genuinely ambiguous ideas instead of hiding it. */
  tie: boolean;
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
