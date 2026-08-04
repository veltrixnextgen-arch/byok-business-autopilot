// Shared types for the six curated business-type task templates.
// Field choices trace directly to docs/product/roles-and-api-key-guide.md Part 2
// (the role catalog) so the extraction pipeline can derive agents and
// teams from task metadata rather than a hardcoded per-business org chart.

// The primitive enums (Frequency, Stakes, Tier, AutonomyDefault, TeamHint,
// HandsScope, BusinessTemplateId) live in @byok/contracts, not here — see
// its primitives.ts for why (ADR-013's amendment). Re-exported so existing
// consumers importing them from "@byok/templates" don't need to change.
export type {
  AutonomyDefault,
  BusinessTemplateId,
  Frequency,
  HandsScope,
  Stakes,
  TeamHint,
  Tier,
} from "@byok/contracts";

import type { AutonomyDefault, BusinessTemplateId, Frequency, HandsScope, InterviewQuestion, Stakes, TeamHint, Tier } from "@byok/contracts";

export interface TemplateTask {
  /** Stable id within the template, e.g. "cfo.invoicing.create". */
  id: string;
  /** Plain-language description — never internal jargon (design law, Part 1). */
  text: string;
  /** Task type. ADR-001: one sub-agent per task type — tasks sharing a
   *  agentType cluster into the same sub-agent. */
  agentType: string;
  /** Human-readable label for the sub-agent this task type clusters into. */
  agentLabel: string;
  teamHint: TeamHint;
  frequency: Frequency;
  stakes: Stakes;
  tier: Tier;
  autonomy: AutonomyDefault;
  /** Extra nuance from the catalog, e.g. "sending" (Invoicing: drafts ⏳ / sending 🔒). */
  autonomyNote?: string;
  /** Hands tool this task will eventually need (service API), or null if none. */
  handsTool: string | null;
  /** Required whenever handsTool is set AND the tool could plausibly serve
   *  either scope (e.g. an accounting API) — omit only when handsTool is
   *  unambiguous (e.g. "GitHub" is never a back-office/client-facing split). */
  handsScope?: HandsScope;
  /** MANDATORY (must be true) whenever teamHint is "compliance" — enforced
   *  as a hard invariant in packages/agents/extraction/src/assemble.ts.
   *  Compliance sub-agents flag for a human professional and never advise
   *  autonomously (Part 2); this field is the machine-checkable version of
   *  that rule, and it's how the UI knows to show the "review with your
   *  professional" banner. Must be omitted/false for non-compliance tasks. */
  requiresProfessionalVerification?: boolean;
}

export interface BusinessTemplate {
  id: BusinessTemplateId;
  name: string;
  description: string;
  tasks: TemplateTask[];
  /** Up to 3 follow-up questions specific to this business type, asked
   *  after the universal 5-question spine once template selection has
   *  narrowed to this template (see packages/agents/extraction's
   *  getInterviewQuestionsForTemplate). Declared here, not in a shared
   *  filtered catalog, because the questions genuinely belong to the
   *  template that needs their answers — adding a template's branches is
   *  then a change to that template file alone, with zero UI changes
   *  (apps/web just renders whatever InterviewQuestion[] the server
   *  returns). Empty array, not optional, for a template with no branch
   *  questions — a template that hasn't needed one yet is a complete,
   *  ordinary state, not a gap to special-case around. */
  branchQuestions: InterviewQuestion[];
}
