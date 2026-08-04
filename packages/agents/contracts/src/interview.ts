// Per ADR-011: the interview extracts the value chain (what customers pay
// for -> who the customer is -> how money arrives -> how delivery reaches
// them -> jurisdiction), not founder preferences — autonomy posture and
// first-hire priority are configuration, asked later (BYOK/ceiling flow),
// not here. "stage" and "whoIsWorkingOnIt" are context, not value-chain or
// preference: they don't change what the business IS, but they shape how
// the reveal and simulated day are framed (a "nothing-yet" idea gets a
// different tone than a "live-business" one).
//
// branchAnswers holds answers to template-declared branch questions
// (packages/templates' BusinessTemplate.branchQuestions), keyed by each
// question's id — always present (empty object if the template declared
// none, or the user used the skip-the-rest escape) rather than optional,
// so every consumer can read it without an existence check.
export interface InterviewAnswers {
  whatCustomersPayFor: string;
  whoTheCustomerIs: "consumers" | "businesses" | "both";
  howMoneyArrives: "one-time" | "subscription" | "invoiced-projects" | "not-sure";
  howDeliveryReaches: "online" | "shipped" | "in-person" | "software-saas" | "not-sure";
  /** Where the business operates — required so compliance-category tasks
   *  never have to guess a jurisdiction before naming any regulation. */
  jurisdiction: {
    country: string;
    stateOrProvince?: string;
  };
  stage: "nothing-yet" | "side-project" | "live-business";
  whoIsWorkingOnIt: "solo" | "me-plus-cofounder" | "small-team-already";
  branchAnswers: Record<string, string>;
}

export type InterviewQuestionKind = "text" | "single-select" | "location";

export interface InterviewQuestionOption {
  value: string;
  label: string;
}

export interface InterviewQuestion {
  /** Matches an InterviewAnswers key for spine/context questions. A
   *  template-declared branch question uses its own id (unique within that
   *  template's branchQuestions array) — answers to those are stored under
   *  InterviewAnswers.branchAnswers[id], not as a top-level field, since
   *  which branch questions exist varies per template. */
  id: string;
  prompt: string;
  kind: InterviewQuestionKind;
  /** Required when kind === "single-select". */
  options?: InterviewQuestionOption[];
}

// The 5-question universal value-chain spine (ADR-011) — every idea gets
// these, regardless of template, in this order. Template selection (and
// therefore which branch questions apply — see packages/agents/extraction's
// getInterviewQuestionsForTemplate) can run on just these answers, since
// templateSelect.ts's actual signals are a subset of them.
const SPINE_QUESTIONS: InterviewQuestion[] = [
  { id: "whatCustomersPayFor", prompt: "What do customers pay you for?", kind: "text" },
  {
    id: "whoTheCustomerIs",
    prompt: "Who's the customer?",
    kind: "single-select",
    options: [
      { value: "consumers", label: "Consumers" },
      { value: "businesses", label: "Businesses" },
      { value: "both", label: "Both" },
    ],
  },
  {
    id: "howMoneyArrives",
    prompt: "How does money arrive?",
    kind: "single-select",
    options: [
      { value: "one-time", label: "One-time purchase" },
      { value: "subscription", label: "Subscription / membership" },
      { value: "invoiced-projects", label: "Invoiced projects" },
      { value: "not-sure", label: "Not sure yet" },
    ],
  },
  {
    id: "howDeliveryReaches",
    prompt: "How does delivery reach them?",
    kind: "single-select",
    options: [
      { value: "online", label: "Digital / delivered online (downloads, content, access)" },
      { value: "shipped", label: "Physical goods shipped to them" },
      { value: "in-person", label: "In person / on-site" },
      { value: "software-saas", label: "Software they log into" },
      { value: "not-sure", label: "Not sure yet" },
    ],
  },
  { id: "jurisdiction", prompt: "Where does the business operate?", kind: "location" },
];

// The 2 universal context questions — asked last, after any template
// branch questions, per the interview's designed order (spine -> branch ->
// context). Don't change what the business IS (that's the spine's job);
// they shape tone (a "nothing-yet" idea vs. a "live-business" one) and
// whether the org-chart reveal assumes a solo founder or an existing team.
const CONTEXT_QUESTIONS: InterviewQuestion[] = [
  {
    id: "stage",
    prompt: "Where is this today?",
    kind: "single-select",
    options: [
      { value: "nothing-yet", label: "Nothing yet" },
      { value: "side-project", label: "Side project" },
      { value: "live-business", label: "Live business" },
    ],
  },
  {
    id: "whoIsWorkingOnIt",
    prompt: "Who's working on it?",
    kind: "single-select",
    options: [
      { value: "solo", label: "Just me" },
      { value: "me-plus-cofounder", label: "Me plus a co-founder" },
      { value: "small-team-already", label: "A small team already" },
    ],
  },
];

export function getSpineQuestions(): InterviewQuestion[] {
  return SPINE_QUESTIONS;
}

export function getContextQuestions(): InterviewQuestion[] {
  return CONTEXT_QUESTIONS;
}
