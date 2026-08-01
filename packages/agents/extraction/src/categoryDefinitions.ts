import type { TeamHint } from "@byok/templates";

// One-line definition + two examples per category, shown to the customize
// pass AND the category-validation pass, so both use the same yardstick.
// Written specifically to close the two mistakes found in the first
// differentiation-test run: (1) "product-dev" getting used for any kind of
// research/new-idea task instead of only software work, and (2) a client's
// paid-work tasks clustering into "cfo" just because they happen to be
// finance-shaped.
export interface CategoryDefinition {
  definition: string;
  examples: [string, string];
}

export const CATEGORY_DEFINITIONS: Record<TeamHint, CategoryDefinition> = {
  founder: {
    definition:
      "ONLY the Chief-of-Staff-style meta-task: synthesizing what OTHER teams already reported into a weekly " +
      "plan, or flagging a conflict BETWEEN two teams. Not a catch-all for strategic-sounding work — " +
      "competitor research, market research, and positioning belong to whichever team would naturally own " +
      "them (usually cmo), even when a founder cares about the results.",
    examples: ["Draft the weekly plan for the founder", "Flag a conflict between two teams' priorities"],
  },
  cfo: {
    definition:
      "The business's OWN finance operations — its invoices, its expenses, its taxes, its cash flow. " +
      "Never the paid work the business sells to customers, even when that work is itself finance-shaped.",
    examples: [
      "Create an invoice for a client payment owed to the business",
      "Categorize this month's software subscription expense",
    ],
  },
  cmo: {
    definition: "Marketing and audience-growth work: content, social, SEO, ads, email campaigns promoting the business itself.",
    examples: ["Draft a social media post announcing a sale", "Write a blog article for the company site"],
  },
  support: {
    definition: "Customer-facing communication and problem-resolution that is NOT the paid deliverable itself.",
    examples: ["Reply to a customer's question about order status", "Escalate an angry customer to a human"],
  },
  sales: {
    definition: "Business development: finding, qualifying, and closing new customers or clients.",
    examples: ["Score an inbound lead's fit", "Draft a follow-up email to a prospect who hasn't replied"],
  },
  ops: {
    definition: "Internal logistics, scheduling, inventory, and vendor management — the mechanics of running the business day to day.",
    examples: ["Track stock levels for a physical product", "Manage the staff shift calendar"],
  },
  delivery: {
    definition:
      "The paid work product done ON BEHALF OF or FOR a customer, but ONLY when that work would otherwise " +
      "wrongly cluster into a back-office category (cfo/ops/cmo) that already has its own correct meaning. " +
      "Does NOT apply when the paid thing already has its own proper category: a SaaS product's own " +
      "spec/code/QA/deploy work is product-dev even though the software IS what's sold — never move software " +
      "engineering into delivery. Rule of thumb: delivery exists to rescue tasks that would otherwise be " +
      "mistagged as internal back-office work when they're actually client-facing paid work; it is not a " +
      "second name for 'this is our product.'",
    examples: [
      "Reconcile a client's bank transactions (the bookkeeping service being sold — would otherwise mistag as cfo)",
      "Write the article a content-agency client commissioned (would otherwise mistag as cmo)",
    ],
  },
  compliance: {
    definition: "Regulatory/legal-adjacent review that flags risk for a human professional — never advises or acts autonomously.",
    examples: ["Flag a contract clause as a red flag for legal review", "Track an upcoming regulatory filing deadline"],
  },
  people: {
    definition: "Hiring and staffing tasks.",
    examples: ["Draft a job post for an open role", "Summarize applicants for a human hiring manager"],
  },
  "product-dev": {
    definition:
      "Building SOFTWARE ONLY — specs, code, QA, deploys for an app or codebase the business is building. " +
      "Test: would this task involve writing, testing, or shipping code? If yes, it is product-dev — " +
      "including QA/testing of that software, even for a SaaS business where the software itself is the paid " +
      "product (do NOT recategorize software QA/spec/deploy as 'delivery' just because it's also what's sold — " +
      "product-dev is the correct, specific category for that, and always wins). If the task involves no " +
      "code at all, it is NOT product-dev, even if it sounds like 'product development' in everyday business " +
      "English: market research, trend-spotting, new-product-line ideation, and physical-product R&D are cmo " +
      "or delivery instead.",
    examples: [
      "Write a feature spec for the next release",
      "Propose a code change through the build pipeline — " +
        "counter-example: 'research trending scents for new candles' is cmo/delivery, NOT product-dev",
    ],
  },
};

export function formatCategoryLegend(): string {
  return (Object.entries(CATEGORY_DEFINITIONS) as [TeamHint, CategoryDefinition][])
    .map(([hint, def]) => `- ${hint}: ${def.definition}\n    e.g. "${def.examples[0]}"; "${def.examples[1]}"`)
    .join("\n");
}
