import type { AutonomyDefault, Frequency, HandsScope, Stakes, TeamHint, Tier } from "@byok/templates";

// ADR-013: OrgChart/Team/Agent/Task/Charter/InterviewQuestion (and their
// supporting shapes) are defined once, in @byok/contracts, as the single
// source of truth extraction produces and apps/web consumes. Re-exported
// here so every file in this package can keep importing from "./types.js"
// without churn — do not redefine any of these shapes locally.
export type {
  Agent,
  ApiCallUsage,
  BrainRecommendation,
  Cadence,
  CategoryCorrection,
  CeoPrompt,
  Charter,
  CharterStatus,
  CompanyCharter,
  CustomizationLog,
  Frequency,
  InterviewAnswers,
  InterviewQuestion,
  InterviewQuestionKind,
  InterviewQuestionOption,
  OnboardingBatch,
  OrgChart,
  PromptCascade,
  PromptTier,
  RoleLeadPrompt,
  RoleMandate,
  SimulatedDayCard,
  SubAgentPrompt,
  Task,
  Team,
  TemplateSelection,
  TriggerType,
} from "@byok/contracts";

// Claude's customize-pass response shape (tool_use input) — extraction-
// internal, never seen by apps/web, so it stays here rather than in the
// shared contract.
export interface CustomizeAddition {
  text: string;
  agentType: string;
  agentLabel: string;
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
