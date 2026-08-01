import type { AutonomyDefault, BusinessTemplateId, Frequency, HandsScope, Stakes, TeamHint, Tier } from "@byok/templates";

// Interview answers per docs/product/roles-and-api-key-guide.md Part 1,
// Screen 2 (the 6-question guided interview).
export interface InterviewAnswers {
  businessType: string;
  whoPays: "consumers" | "businesses" | "both";
  channels: "online" | "local" | "referrals" | "not-sure";
  status: "nothing-yet" | "side-project" | "live-business";
  dread: "money" | "marketing" | "customer-messages" | "admin";
  budget: "10" | "25" | "50+" | "whatever-it-takes";
  /** Where the business operates — required so compliance-category tasks
   *  never have to guess a jurisdiction before naming any regulation. */
  jurisdiction: {
    country: string;
    stateOrProvince?: string;
  };
}

export interface OrgChartTask {
  id: string;
  text: string;
  subAgentType: string;
  subAgentLabel: string;
  teamHint: TeamHint;
  frequency: Frequency;
  stakes: Stakes;
  tier: Tier;
  autonomy: AutonomyDefault;
  autonomyNote?: string;
  handsTool: string | null;
  handsScope?: HandsScope;
  /** MANDATORY true whenever teamHint === "compliance" — hard invariant,
   *  enforced in assemble.ts. See TemplateTask for the full rationale. */
  requiresProfessionalVerification?: boolean;
  origin: "template" | "customize-added";
}

export interface OrgChartSubAgent {
  id: string;
  label: string;
  teamId: TeamHint;
  taskIds: string[];
  suggestedTier: Tier;
  autonomyDefault: AutonomyDefault;
  handsTools: string[];
}

export interface OrgChartTeam {
  id: TeamHint;
  roleTitle: string;
  isHuman: boolean;
  subAgentIds: string[];
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

// master-plan-v2.md §4 (Phase A): "Task Extraction Engine ... also emits the
// simulated-day script and Charter draft from the same batch." Per
// docs/product/userflow-v2.md Stage 2 Screen 6: a mock morning digest with
// fake approval cards, illustrative only, zero real execution.
export interface SimulatedDayCard {
  agentName: string;
  subAgentId: string;
  roleTitle: string;
  summary: string;
}

// Per docs/product/userflow-v2.md Stage 4, Screen 10.
export interface CharterDraft {
  sharpenedIdea: string;
  mvpDefinition: string;
  roleTasks: { roleTitle: string; tasks: string[] }[];
  monthOneGoals: string[];
  budgetCeilingPlaceholder: string;
}

export interface OnboardingBatch {
  simulatedDay: SimulatedDayCard[];
  charterDraft: CharterDraft;
}

export interface OrgChart {
  meta: {
    idea: string;
    generatedAt: string;
    templateSelection: TemplateSelection;
    calls: ApiCallUsage[];
    costUsd: number; // sum of calls[].costUsd — the real per-signup CAC
  };
  teams: OrgChartTeam[];
  subAgents: OrgChartSubAgent[];
  tasks: OrgChartTask[];
  customization: CustomizationLog;
  /** null only if generation was skipped after a budget/transient failure
   *  (see onboardingBatch.ts) — the org chart itself is still valid. */
  onboardingBatch: OnboardingBatch | null;
}

// Claude's customize-pass response shape (tool_use input).
export interface CustomizeAddition {
  text: string;
  subAgentType: string;
  subAgentLabel: string;
  teamHint: TeamHint;
  frequency: Frequency;
  stakes: Stakes;
  tier: Tier;
  autonomy: AutonomyDefault;
  handsTool: string | null;
  handsScope?: HandsScope;
  requiresProfessionalVerification?: boolean;
  rationale: string;
}

export interface CustomizeResult {
  addTasks: CustomizeAddition[];
  removeTaskIds: string[];
  frequencyAdjustments: { taskId: string; frequency: Frequency }[];
  notes?: string;
}
