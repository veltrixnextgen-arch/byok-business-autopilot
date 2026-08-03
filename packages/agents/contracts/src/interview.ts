import type { BusinessTemplateId } from "@byok/templates";

// Per ADR-011: the interview extracts the value chain (what customers pay
// for -> who the customer is -> how money arrives -> how delivery reaches
// them -> jurisdiction), not founder preferences — autonomy posture and
// first-hire priority are configuration, asked later (BYOK/ceiling flow),
// not here. Answers per docs/product/roles-and-api-key-guide.md Part 1,
// Screen 2 (the guided interview).
export interface InterviewAnswers {
  businessType: string;
  whoPays: "consumers" | "businesses" | "both";
  channels: "online" | "local" | "referrals" | "not-sure";
  status: "nothing-yet" | "side-project" | "live-business";
  dread: "money" | "marketing" | "customer-messages" | "admin";
  budget: "10" | "25" | "50+" | "whatever-it-takes";
  /** Where the business operates — required so compliance-category tasks
   *  never have to guess a jurisdiction before naming any regulation. */
  jurisdiction: {
    country: string;
    stateOrProvince?: string;
  };
}

export type InterviewQuestionKind = "text" | "single-select" | "location";

export interface InterviewQuestionOption {
  value: string;
  label: string;
}

export interface InterviewQuestion {
  /** Matches an InterviewAnswers key for the core questions; a
   *  template-declared branch question uses its own id, namespaced by the
   *  template that declared it (see BRANCH_QUESTIONS below) so ids never
   *  collide across templates. */
  id: string;
  prompt: string;
  kind: InterviewQuestionKind;
  /** Required when kind === "single-select". */
  options?: InterviewQuestionOption[];
  /** Undefined = asked for every idea (one of the core value-chain
   *  questions below). Present = a template-declared branch question,
   *  only asked once template selection has narrowed to one of these
   *  templates — e.g. a physical-space template might ask about
   *  visit/membership cadence where an e-commerce template wouldn't. */
  appliesToTemplates?: BusinessTemplateId[];
}

// The core, universal value-chain questions (ADR-011) — every idea gets
// these, regardless of template. Order matches InterviewAnswers' own
// customer-to-CEO walk.
const CORE_QUESTIONS: InterviewQuestion[] = [
  { id: "businessType", prompt: "Describe your business idea.", kind: "text" },
  {
    id: "whoPays",
    prompt: "Who pays you?",
    kind: "single-select",
    options: [
      { value: "consumers", label: "Consumers" },
      { value: "businesses", label: "Businesses" },
      { value: "both", label: "Both" },
    ],
  },
  {
    id: "channels",
    prompt: "How do customers find or reach you?",
    kind: "single-select",
    options: [
      { value: "online", label: "Online" },
      { value: "local", label: "Local / in-person" },
      { value: "referrals", label: "Referrals" },
      { value: "not-sure", label: "Not sure yet" },
    ],
  },
  {
    id: "status",
    prompt: "Where is this today?",
    kind: "single-select",
    options: [
      { value: "nothing-yet", label: "Nothing yet" },
      { value: "side-project", label: "Side project" },
      { value: "live-business", label: "Live business" },
    ],
  },
  {
    id: "dread",
    prompt: "What part of running this do you dread most?",
    kind: "single-select",
    options: [
      { value: "money", label: "Money / finances" },
      { value: "marketing", label: "Marketing" },
      { value: "customer-messages", label: "Customer messages" },
      { value: "admin", label: "Admin" },
    ],
  },
  {
    id: "budget",
    prompt: "What's a comfortable starting AI budget per month?",
    kind: "single-select",
    options: [
      { value: "10", label: "$10" },
      { value: "25", label: "$25" },
      { value: "50+", label: "$50+" },
      { value: "whatever-it-takes", label: "Whatever it takes" },
    ],
  },
  { id: "jurisdiction", prompt: "Where does the business operate?", kind: "location" },
];

// No template has a real branch question yet — none of the 6 templates
// (packages/templates) have been designed with template-specific
// follow-ups. This is the extension point for that: a question here with
// `appliesToTemplates` set is only surfaced once template selection has
// narrowed to a matching template. Adding one is a content decision (what
// to ask, for which template, and why) that hasn't been made — inventing
// placeholder questions here would be exactly the "invent it in the UI/
// engine instead of deciding it for real" anti-pattern ADR-013 exists to
// prevent, so this stays empty until that decision is actually made.
const BRANCH_QUESTIONS: InterviewQuestion[] = [];

export function getCoreInterviewQuestions(): InterviewQuestion[] {
  return CORE_QUESTIONS;
}

/** The full question set for a given idea: core questions always, plus any
 *  branch questions declared for the given template once selection has
 *  narrowed to it. Pass null/undefined before template selection has run
 *  (core questions only). */
export function getInterviewQuestions(templateHint?: BusinessTemplateId | null): InterviewQuestion[] {
  if (!templateHint) return CORE_QUESTIONS;
  const branch = BRANCH_QUESTIONS.filter((q) => q.appliesToTemplates?.includes(templateHint));
  return [...CORE_QUESTIONS, ...branch];
}
