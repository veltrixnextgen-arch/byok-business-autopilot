import type { TemplateTask } from "./types.js";

// Universal across "almost every business" (Part 2, FOUNDER/CEO). Present
// identically in all five templates, so it never drives differentiation
// between charts — it's the one team every business gets.
export const chiefOfStaffTask: TemplateTask = {
  id: "founder.chief-of-staff.weekly-plan",
  text: "Draft the weekly plan and flag cross-team conflicts for the founder",
  subAgentType: "chief-of-staff",
  subAgentLabel: "Chief of Staff",
  teamHint: "founder",
  frequency: "weekly",
  stakes: "medium",
  tier: "T3",
  autonomy: "earnable",
  handsTool: null,
};
