// Primitive enums shared across the whole extraction/UI type graph.
// Field choices trace directly to docs/product/roles-and-api-key-guide.md
// Part 2 (the role catalog) so the extraction pipeline can derive agents
// and teams from task metadata rather than a hardcoded per-business org
// chart.
//
// These live here, not in @byok/templates, so @byok/contracts has no
// dependency on @byok/templates at all: @byok/templates depends on
// @byok/contracts instead (it needs InterviewQuestion for
// BusinessTemplate.branchQuestions — ADR-013's amendment), and a package
// can't depend on itself through a cycle. Templates re-exports these from
// its own types.ts so existing consumers (packages/agents/extraction, etc.)
// don't need to change their import path.

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

export type BusinessTemplateId = "ecommerce" | "service" | "saas" | "content" | "local" | "physical-space" | "food-hospitality";

// R1 (docs/architecture/automation-runtime-plan.md §3, §7): scheduling
// metadata, finer-grained than Frequency and distinct from it. Frequency
// describes how often the catalog says a task happens; Cadence is the
// interval a scheduler (R3+) can actually fire on, down to the 15-minute
// Agency-tier floor. null means the task has no standing schedule of its
// own — it's driven by an event or has none yet (see TriggerType).
export type Cadence = "15min" | "hourly" | "nightly" | "daily" | "weekly" | "monthly";

// What initiates a run (plan §3): "cadence" fires on a schedule, "event"
// fires on an inbound signal (a webhook, in R6 — until then the task has
// no dispatch path and cadence stays null), "threshold" is itself
// schedule-driven but only acts when a watched value crosses a limit
// (plan §3c: "no new infrastructure, just a cadence trigger with a
// condition") — its cadence field is the check interval, not the action.
export type TriggerType = "cadence" | "event" | "threshold";
