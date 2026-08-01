// Shared types for the five curated business-type task templates.
// Field choices trace directly to docs/product/roles-and-api-key-guide.md Part 2
// (the role catalog) so the extraction pipeline can derive sub-agents and
// teams from task metadata rather than a hardcoded per-business org chart.

export type Frequency = "daily" | "weekly" | "monthly" | "adhoc";
export type Stakes = "low" | "medium" | "high";

// Catalog tiers: T1 cheap/fast, T2 mid (drafting/reasoning), T3 frontier (strategy/high-stakes).
export type Tier = "T1" | "T2" | "T3";

// Catalog autonomy symbols: 🔒 locked, ⏳ earnable after approvals, ✅ eligible early.
export type AutonomyDefault = "locked" | "earnable" | "eligible-early";

// One team per role lead in the catalog. "founder" is special: its role lead
// is the human user, not an agent (see Part 2, FOUNDER/CEO).
export type TeamHint =
  | "founder"
  | "cfo"
  | "cmo"
  | "support"
  | "sales"
  | "ops"
  | "compliance"
  | "people"
  | "product-dev";

export interface TemplateTask {
  /** Stable id within the template, e.g. "cfo.invoicing.create". */
  id: string;
  /** Plain-language description — never internal jargon (design law, Part 1). */
  text: string;
  /** Task type. ADR-001: one sub-agent per task type — tasks sharing a
   *  subAgentType cluster into the same sub-agent. */
  subAgentType: string;
  /** Human-readable label for the sub-agent this task type clusters into. */
  subAgentLabel: string;
  teamHint: TeamHint;
  frequency: Frequency;
  stakes: Stakes;
  tier: Tier;
  autonomy: AutonomyDefault;
  /** Extra nuance from the catalog, e.g. "sending" (Invoicing: drafts ⏳ / sending 🔒). */
  autonomyNote?: string;
  /** Hands tool this task will eventually need (service API), or null if none. */
  handsTool: string | null;
}

export type BusinessTemplateId = "ecommerce" | "service" | "saas" | "content" | "local";

export interface BusinessTemplate {
  id: BusinessTemplateId;
  name: string;
  description: string;
  tasks: TemplateTask[];
}
