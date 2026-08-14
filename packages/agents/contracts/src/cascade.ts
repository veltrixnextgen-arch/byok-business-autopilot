// R2 (docs/architecture/automation-runtime-plan.md §2, ADR-024): the
// three-tier prompt cascade generated deterministically from a Charter +
// org chart. No LLM call — see packages/agents/extraction/src/cascade.ts's
// generateCascade. Composed by the router per dispatch from the versioned
// Charter (security-architecture.md §5.1's "immutable role prompts"), never
// mutable by anything an agent reads.
export type PromptTier = "ceo" | "role-lead" | "sub-agent";

/** Shared by every tier. `overridden` is set only when a human has replaced
 *  the deterministically-generated text with their own — see ADR-024's
 *  override rule: regeneration (Charter edit, agent rename, autonomy
 *  change) never silently clobbers an overridden entry. */
interface GeneratedPromptBase {
  text: string;
  overridden: boolean;
  overrideNote?: string;
}

export interface CeoPrompt extends GeneratedPromptBase {
  tier: "ceo";
}

export interface RoleLeadPrompt extends GeneratedPromptBase {
  tier: "role-lead";
  roleTitle: string;
}

export interface SubAgentPrompt extends GeneratedPromptBase {
  tier: "sub-agent";
  agentId: string;
}

/** One per tenant's active CompanyCharter (@byok/contracts' `Charter`
 *  interface) — the CEO prompt is singular (there is exactly one CEO agent,
 *  the Founder team's chief-of-staff agent, per every template), role-lead
 *  and sub-agent prompts are one each per non-human team / per agent in the
 *  org chart. */
export interface PromptCascade {
  ceo: CeoPrompt;
  roleLeads: RoleLeadPrompt[];
  subAgents: SubAgentPrompt[];
}
