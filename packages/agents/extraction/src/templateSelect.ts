import type { BusinessTemplateId } from "@byok/templates";
import type { InterviewAnswers, TemplateSelection } from "./types.js";

// v2 template selection (see docs/DECISIONS.md ADR-023 — the meal-prep
// misclassification incident). v1 scored idea-text keywords only, which
// let a single stray word (originally "subscription" in the saas list)
// outweigh what the founder had already explicitly told us via the
// structured spine answers. v2 makes the structured answers — the fields
// the interview is actually FOR — the dominant signal, and idea-text
// keywords a secondary nudge that only matters when the structured
// signal is weak or absent (e.g. howDeliveryReaches: "not-sure").
//
// A keyword-audit pass (post-incident) also removed every keyword found
// describing a business MODEL rather than a business TYPE — "startup"
// (maturity, not a vertical), "membership"/"rental"/"booking" (payment/
// access model, not a space type), "marketplace"/"platform"/"tool"/
// "build" (too generic to discriminate), and service's own "service"/
// "services" (near-universal — "meal-prep service," "subscription
// service" — noise, not signal). Business-model facts belong to
// howMoneyArrives; this file must never re-derive them from free text.
const KEYWORDS: Record<BusinessTemplateId, string[]> = {
  ecommerce: [
    "sell", "shop", "store", "etsy", "shopify", "product", "products", "goods",
    "handmade", "craft", "ship", "shipping", "inventory",
    "candle", "retail",
  ],
  service: [
    "consulting", "consultant", "freelance", "agency",
    "bookkeeping", "bookkeeper", "client", "clients", "hire me", "contractor",
    "broker", "brokerage", "advisor", "advisory", "mortgage", "loan", "firm",
  ],
  saas: [
    "saas", "software", "app", "web app",
    "api", "waitlist", "product-led",
  ],
  content: [
    "content", "creator", "youtube", "newsletter", "podcast", "course", "blog",
    "audience", "subscribers", "sponsorship",
  ],
  local: [
    "cafe", "coffee shop", "salon", "storefront", "brick-and-mortar", "local shop",
    "walk-in", "in-store",
  ],
  "physical-space": [
    "makerspace", "coworking", "co-working", "gym",
    "climbing gym", "studio space",
    "class pass", "day pass", "facility",
  ],
  "food-hospitality": [
    "restaurant", "meal prep", "meal-prep", "catering", "caterer",
    "commissary", "kitchen", "chef", "food truck", "bakery", "cafe menu",
  ],
};

// Structured-answer signal — the primary signal (see header comment).
// Each entry's weight (3) is deliberately larger than a single keyword
// hit (1): one explicit structured answer should outweigh 1-2 stray
// keyword matches elsewhere in free text, not the other way around.
// Nothing here reads howMoneyArrives — payment model doesn't predict
// business type (that's the exact bug this file exists to not repeat),
// so it contributes no template bonus at all, structured or keyword.
const STRUCTURED_WEIGHT = 3;

function structuredScores(answers: Partial<InterviewAnswers>): Partial<Record<BusinessTemplateId, number>> {
  const bonus: Partial<Record<BusinessTemplateId, number>> = {};
  const add = (id: BusinessTemplateId, amount: number) => {
    bonus[id] = (bonus[id] ?? 0) + amount;
  };

  switch (answers.howDeliveryReaches) {
    case "software-saas":
      add("saas", STRUCTURED_WEIGHT);
      break;
    case "shipped":
      // Ambiguous between "ships retail goods" and "delivers prepared
      // food" (meal-prep/catering has no better delivery answer to pick)
      // — both get the signal, idea-text keywords decide between them.
      // Found via regression: giving this to ecommerce alone routed a
      // real meal-prep run to ecommerce (no food/kitchen tasks at all)
      // purely off this one structured bonus outweighing food-
      // hospitality's own keyword hits.
      add("ecommerce", STRUCTURED_WEIGHT - 1);
      add("food-hospitality", STRUCTURED_WEIGHT - 1);
      break;
    case "in-person":
      // Ambiguous between local and physical-space — NOT
      // food-hospitality, deliberately: unlike those two, food-
      // hospitality is a narrow vertical (found via regression: a
      // blanket in-person bonus tied it with physical-space on a wedding
      // photographer, zero food-keyword backing on either side). Narrow
      // categories earn their signal from real keyword hits only, not a
      // generic delivery-mode proxy shared with broad categories.
      add("local", STRUCTURED_WEIGHT - 1);
      add("physical-space", STRUCTURED_WEIGHT - 1);
      break;
    case "online":
      add("content", STRUCTURED_WEIGHT - 1);
      break;
    default:
      break;
  }

  if (answers.howMoneyArrives === "invoiced-projects") add("service", STRUCTURED_WEIGHT);

  // Mild, not dominant — B2B exists in both service and saas, so this
  // shouldn't decide the outcome on its own the way the delivery/money
  // signals above do.
  if (answers.whoTheCustomerIs === "businesses") add("service", 1);

  return bonus;
}

// Explicit, documented tiebreak — used ONLY when two templates score
// exactly equal. Previously ties resolved via Object.keys() insertion
// order, an implicit accident (found via the makerspace fixture: ecommerce
// beat local 1-1 purely because it's declared first in KEYWORDS). Narrower,
// higher-signal templates rank above broad catch-alls here, since an exact
// tie usually means the idea only matched generic words shared across
// templates rather than either template's real signal.
const TIEBREAK_PRIORITY: BusinessTemplateId[] = [
  "saas", "content", "physical-space", "food-hospitality", "local", "service", "ecommerce",
];

function tiebreakRank(id: BusinessTemplateId): number {
  const idx = TIEBREAK_PRIORITY.indexOf(id);
  return idx === -1 ? TIEBREAK_PRIORITY.length : idx;
}

const BLEND_THRESHOLD_RATIO = 0.7; // if 2nd-best score >= 70% of the best, blend

// Partial, not InterviewAnswers: template selection only ever reads
// whatCustomersPayFor/howDeliveryReaches/howMoneyArrives/whoTheCustomerIs,
// so it's safe — and needed — to call this on just the 5-question spine,
// before branch or context questions are answered, to decide which
// template's branch questions to show next (getInterviewQuestionsForTemplate).
// pipeline.ts's own later call, after every answer is in, benefits from the
// full object but doesn't require it.
export function selectTemplate(idea: string, answers: Partial<InterviewAnswers>): TemplateSelection {
  const haystack = `${idea} ${answers.whatCustomersPayFor ?? ""}`.toLowerCase();
  const structured = structuredScores(answers);

  const scores = Object.fromEntries(
    (Object.keys(KEYWORDS) as BusinessTemplateId[]).map((id) => {
      let score = structured[id] ?? 0;
      for (const kw of KEYWORDS[id]) {
        if (haystack.includes(kw)) score += 1;
      }
      return [id, score];
    }),
  ) as Record<BusinessTemplateId, number>;

  // Explicit founder disambiguation always wins, no matter how the
  // scores came out — see interviewQuestions.ts's buildDisambiguationQuestion.
  // Scores are still returned (not short-circuited above) so this stays
  // debuggable: a caller can see what the keyword/structured signal
  // WOULD have picked, next to what the founder actually chose.
  const override = answers.branchAnswers?.templateDisambiguation as BusinessTemplateId | undefined;
  if (override && override in KEYWORDS) {
    return { primary: override, blendedWith: null, scores, tie: false, confidence: "high" };
  }

  const ranked = (Object.entries(scores) as [BusinessTemplateId, number][]).sort(
    (a, b) => b[1] - a[1] || tiebreakRank(a[0]) - tiebreakRank(b[0]),
  );
  const [best, bestScore] = ranked[0];
  const [second, secondScore] = ranked[1];

  const blendedWith = bestScore > 0 && secondScore >= bestScore * BLEND_THRESHOLD_RATIO && secondScore > 0 ? second : null;
  const tie = bestScore === secondScore;

  // Confidence signal (the makerspace-coin-flip / meal-prep case): when
  // the top two candidates are this close, the pick is a guess dressed up
  // as a decision. Logged unconditionally (not just in dev) so a real
  // run's low-confidence picks show up in the same place customize.ts's
  // own [category-validate] lines already do — visible in the same
  // console output this codebase already reads after every run, not a
  // silent metric nobody looks at.
  const confidence: TemplateSelection["confidence"] = blendedWith !== null || tie ? "low" : "high";
  if (confidence === "low") {
    console.error(
      `[template-select] low confidence: "${best}" (${bestScore}) vs "${second}" (${secondScore})` +
        `${tie ? " — exact tie" : ""} for idea: "${idea.slice(0, 120)}"`,
    );
  }

  return { primary: best, blendedWith, scores, tie, confidence };
}
