import type { TemplateTask } from "./types.js";

// Universal across "almost every business" (Part 2, FOUNDER/CEO). Present
// identically in all five templates, so it never drives differentiation
// between charts — it's the one team every business gets.
export const chiefOfStaffTask: TemplateTask = {
  id: "founder.chief-of-staff.weekly-plan",
  text: "Draft the weekly plan and flag cross-team conflicts for the founder",
  agentType: "chief-of-staff",
  agentLabel: "Chief of Staff",
  teamHint: "founder",
  frequency: "weekly",
  stakes: "medium",
  tier: "T3",
  autonomy: "earnable",
  handsTool: null,
  cadence: "weekly",
  batchable: false,
  triggerType: "cadence",
};
