import type { BusinessTemplate, TemplateTask } from "./types.js";
import { chiefOfStaffTask } from "./common.js";

// Professional/local service business (consulting, bookkeeping, agencies).
// Per Part 2's example ("freelance bookkeeping service"): CFO + Sales as
// the heart of the org (qualifier/outreach/proposals) + Support that's
// onboarding-heavy + a Compliance sub-agent, with NO fulfillment and only
// minimal marketing.
//
// Delivery vs. CFO: this template's CFO tasks are strictly the business's
// OWN finance (its own invoices, its own expenses, its own taxes) using
// "own-backoffice" Hands scope. The paid work itself — the actual service
// being delivered to clients — belongs to "delivery" instead, scoped
// "client-facing". For a finance-adjacent service (bookkeeping, tax prep,
// financial consulting) this split matters most, since without it the
// paid deliverable would otherwise clump into the same categoryHint as
// back-office bookkeeping and inflate CFO's apparent size.
const tasks: TemplateTask[] = [
  chiefOfStaffTask,

  // CFO
  {
    id: "cfo.invoicing.create",
    text: "Create invoices for client retainers/projects",
    subAgentType: "invoicing",
    subAgentLabel: "Invoicing",
    teamHint: "cfo",
    frequency: "weekly",
    stakes: "low",
    tier: "T2",
    autonomy: "earnable",
    handsTool: "Stripe",
    handsScope: "own-backoffice",
  },
  {
    id: "cfo.invoicing.remind",
    text: "Draft payment reminders matched to client history",
    subAgentType: "invoicing",
    subAgentLabel: "Invoicing",
    teamHint: "cfo",
    frequency: "weekly",
    stakes: "medium",
    tier: "T2",
    autonomy: "earnable",
    autonomyNote: "drafts only — sending stays locked",
    handsTool: "Stripe",
    handsScope: "own-backoffice",
  },
  {
    id: "cfo.expenses.categorize",
    text: "Tag business expenses and flag anomalies",
    subAgentType: "expense-categorization",
    subAgentLabel: "Expense categorization",
    teamHint: "cfo",
    frequency: "weekly",
    stakes: "low",
    tier: "T1",
    autonomy: "eligible-early",
    autonomyNote: "after 10 approvals",
    handsTool: null,
  },
  {
    id: "cfo.cashflow.forecast",
    text: "30/60/90-day cash-flow projection and runway alerts",
    subAgentType: "cashflow-forecast",
    subAgentLabel: "Cash-flow forecast",
    teamHint: "cfo",
    frequency: "monthly",
    stakes: "medium",
    tier: "T2",
    autonomy: "earnable",
    autonomyNote: "reports only",
    handsTool: null,
  },
  {
    id: "cfo.tax.tracker",
    text: "Track tax deadlines and prep the accountant handoff packet",
    subAgentType: "tax-deadline-tracker",
    subAgentLabel: "Tax-deadline tracker",
    teamHint: "cfo",
    frequency: "monthly",
    stakes: "medium",
    tier: "T1",
    autonomy: "locked",
    handsTool: null,
  },

  // Delivery — the paid work itself, distinct from CFO's own back-office
  // finance. Generic scaffold; the customize pass fills in what the paid
  // work actually is for this specific idea (e.g. bookkeeping reconciliation
  // for a bookkeeping service) and MUST tag those additions "delivery", not
  // "cfo" — even when the paid work happens to be finance-shaped.
  {
    id: "delivery.core.execute",
    text: "Do the core paid work for each client",
    subAgentType: "core-service-delivery",
    subAgentLabel: "Service delivery",
    teamHint: "delivery",
    frequency: "weekly",
    stakes: "high",
    tier: "T2",
    autonomy: "locked",
    autonomyNote: "this is the paid deliverable — never autonomous at MVP-0",
    handsTool: "Client-facing systems (per-client, scoped access)",
    handsScope: "client-facing",
  },
  {
    id: "delivery.core.qa",
    text: "Check completed client work for accuracy before it goes out",
    subAgentType: "delivery-qa",
    subAgentLabel: "Delivery QA",
    teamHint: "delivery",
    frequency: "weekly",
    stakes: "high",
    tier: "T2",
    autonomy: "locked",
    handsTool: null,
  },
  {
    id: "delivery.core.handoff",
    text: "Package and send finished work to the client",
    subAgentType: "delivery-handoff",
    subAgentLabel: "Delivery handoff",
    teamHint: "delivery",
    frequency: "weekly",
    stakes: "medium",
    tier: "T1",
    autonomy: "earnable",
    handsTool: "Client-facing systems (per-client, scoped access)",
    handsScope: "client-facing",
  },

  // Sales — the heart
  {
    id: "sales.qualifier.score",
    text: "Score inbound leads and enrich them from public info",
    subAgentType: "lead-qualifier",
    subAgentLabel: "Lead qualifier",
    teamHint: "sales",
    frequency: "daily",
    stakes: "low",
    tier: "T1",
    autonomy: "eligible-early",
    handsTool: "CRM",
  },
  {
    id: "sales.outreach.draft",
    text: "Draft personalized first-touch and follow-up outreach",
    subAgentType: "outreach-drafter",
    subAgentLabel: "Outreach drafter",
    teamHint: "sales",
    frequency: "daily",
    stakes: "medium",
    tier: "T2",
    autonomy: "locked",
    autonomyNote: "sending, always",
    handsTool: "Email",
  },
  {
    id: "sales.crm.hygiene",
    text: "Log interactions, update deal stages, flag stale deals",
    subAgentType: "crm-hygiene",
    subAgentLabel: "CRM hygiene",
    teamHint: "sales",
    frequency: "daily",
    stakes: "low",
    tier: "T1",
    autonomy: "eligible-early",
    autonomyNote: "after 10",
    handsTool: "CRM",
  },
  {
    id: "sales.proposal.build",
    text: "Build quotes/proposals from templates and deal context",
    subAgentType: "proposal-builder",
    subAgentLabel: "Proposal builder",
    teamHint: "sales",
    frequency: "weekly",
    stakes: "medium",
    tier: "T2",
    autonomy: "locked",
    autonomyNote: "sending",
    handsTool: "CRM",
  },

  // Support — onboarding-heavy
  {
    id: "support.onboarding.welcome",
    text: "Draft welcome sequences for new clients",
    subAgentType: "onboarding",
    subAgentLabel: "Onboarding",
    teamHint: "support",
    frequency: "weekly",
    stakes: "low",
    tier: "T2",
    autonomy: "earnable",
    handsTool: "Email",
  },
  {
    id: "support.onboarding.setup",
    text: "Draft setup guides and check-in messages for new clients",
    subAgentType: "onboarding",
    subAgentLabel: "Onboarding",
    teamHint: "support",
    frequency: "weekly",
    stakes: "low",
    tier: "T2",
    autonomy: "earnable",
    handsTool: null,
  },
  {
    id: "support.triage.inbound",
    text: "Read inbound client messages, tag urgency, draft replies to known questions",
    subAgentType: "tier1-triage",
    subAgentLabel: "Tier-1 triage",
    teamHint: "support",
    frequency: "daily",
    stakes: "low",
    tier: "T1",
    autonomy: "earnable",
    autonomyNote: "known-answer replies",
    handsTool: "Shared inbox",
  },
  {
    id: "support.escalation.detect",
    text: "Detect complex or upset cases and package context for the human",
    subAgentType: "escalation",
    subAgentLabel: "Escalation",
    teamHint: "support",
    frequency: "weekly",
    stakes: "high",
    tier: "T2",
    autonomy: "locked",
    autonomyNote: "always routes to human",
    handsTool: null,
  },

  // Compliance sub-agent (attaches to CFO — Part 2)
  {
    id: "compliance.review",
    text: "Flag contract red-flags and track regulation deadlines",
    subAgentType: "compliance-review",
    subAgentLabel: "Compliance sub-agent",
    teamHint: "compliance",
    frequency: "monthly",
    stakes: "high",
    tier: "T3",
    autonomy: "locked",
    autonomyNote: "flags for human + user's own lawyer/accountant, never advises autonomously",
    handsTool: null,
  },

  // Minimal marketing
  {
    id: "cmo.social.expertise",
    text: "Draft occasional posts establishing professional expertise",
    subAgentType: "social-manager",
    subAgentLabel: "Social manager",
    teamHint: "cmo",
    frequency: "monthly",
    stakes: "low",
    tier: "T1",
    autonomy: "earnable",
    handsTool: null,
  },

  // Light scheduling (client calls)
  {
    id: "ops.scheduling.calls",
    text: "Manage calendar, booking confirmations and reminders for client calls",
    subAgentType: "scheduling",
    subAgentLabel: "Scheduling",
    teamHint: "ops",
    frequency: "weekly",
    stakes: "low",
    tier: "T1",
    autonomy: "earnable",
    handsTool: "Calendar",
  },
];

export const serviceTemplate: BusinessTemplate = {
  id: "service",
  name: "Service business",
  description: "Professional or local services sold to consumers or businesses (consulting, bookkeeping, agencies).",
  tasks,
};
