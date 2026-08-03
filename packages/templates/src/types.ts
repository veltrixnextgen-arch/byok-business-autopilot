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
//
// "delivery" is not in the original catalog — it exists for businesses whose
// paid deliverable overlaps a back-office category (e.g. a bookkeeping
// service whose product IS finance work). Rule: tasks that ARE the
// customer-facing paid work cluster into "delivery"; "cfo" holds ONLY the
// business's OWN finance tasks (its own invoices, its own expenses, its own
// taxes). See packages/agents/extraction/src/assemble.ts for the Hands-scope
// separation this enables.
export type TeamHint =
  | "founder"
  | "cfo"
  | "cmo"
  | "support"
  | "sales"
  | "ops"
  | "delivery"
  | "compliance"
  | "people"
  | "product-dev";

// Only meaningful when handsTool is set. Distinguishes access to the
// business's OWN systems (its own bank/books) from access scoped to a
// CLIENT's systems (their books, their accounts) — these must never be the
// same literal Hands tool identifier, even when the underlying provider is
// the same (e.g. QuickBooks), because one is the business's own credential
// and the other is a per-client, just-in-time credential (ADR-002).
export type HandsScope = "own-backoffice" | "client-facing";

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

export type BusinessTemplateId = "ecommerce" | "service" | "saas" | "content" | "local" | "physical-space";

export interface BusinessTemplate {
  id: BusinessTemplateId;
  name: string;
  description: string;
  tasks: TemplateTask[];
}
