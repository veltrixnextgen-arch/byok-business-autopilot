import type { AutonomyDefault, BusinessTemplateId, Frequency, Stakes, TeamHint, Tier } from "@byok/templates";

// Interview answers per docs/product/roles-and-api-key-guide.md Part 1,
// Screen 2 (the 6-question guided interview).
export interface InterviewAnswers {
  businessType: string;
  whoPays: "consumers" | "businesses" | "both";
  channels: "online" | "local" | "referrals" | "not-sure";
  status: "nothing-yet" | "side-project" | "live-business";
  dread: "money" | "marketing" | "customer-messages" | "admin";
  budget: "10" | "25" | "50+" | "whatever-it-takes";
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
}

export interface CustomizationLog {
  added: string[];
  removed: string[];
  frequencyAdjustments: { taskId: string; from: Frequency; to: Frequency }[];
  notes?: string;
}

export interface OrgChart {
  meta: {
    idea: string;
    generatedAt: string;
    templateSelection: TemplateSelection;
    model: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  };
  teams: OrgChartTeam[];
  subAgents: OrgChartSubAgent[];
  tasks: OrgChartTask[];
  customization: CustomizationLog;
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
  rationale: string;
}

export interface CustomizeResult {
  addTasks: CustomizeAddition[];
  removeTaskIds: string[];
  frequencyAdjustments: { taskId: string; frequency: Frequency }[];
  notes?: string;
}
