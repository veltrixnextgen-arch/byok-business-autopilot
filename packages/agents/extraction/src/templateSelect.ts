import type { BusinessTemplateId } from "@byok/templates";
import type { InterviewAnswers, TemplateSelection } from "./types.js";

// v1 template selection: keyword scoring against the idea text + the
// "what customers pay for" spine answer, with light signal from
// howDeliveryReaches/stage. This is deliberately simple (no ML) — good
// enough to route the three canonical differentiation-test ideas cleanly,
// and blends when two templates are close instead of forcing a single
// guess.
const KEYWORDS: Record<BusinessTemplateId, string[]> = {
  ecommerce: [
    "sell", "shop", "store", "etsy", "shopify", "product", "products", "goods",
    "handmade", "craft", "physical", "ship", "shipping", "inventory", "marketplace",
    "candle", "retail",
  ],
  service: [
    "service", "services", "consulting", "consultant", "freelance", "agency",
    "bookkeeping", "bookkeeper", "client", "clients", "hire me", "contractor",
    "broker", "brokerage", "advisor", "advisory", "mortgage", "loan", "firm",
  ],
  saas: [
    "saas", "software", "app", "platform", "tool", "subscription", "web app",
    "api", "build", "startup", "waitlist", "product-led",
  ],
  content: [
    "content", "creator", "youtube", "newsletter", "podcast", "course", "blog",
    "audience", "subscribers", "sponsorship",
  ],
  local: [
    "cafe", "coffee shop", "salon", "storefront", "brick-and-mortar", "local shop",
    "restaurant", "walk-in", "in-store",
  ],
  "physical-space": [
    "makerspace", "membership", "memberships", "coworking", "co-working", "gym",
    "climbing gym", "studio space", "rental", "rentals", "equipment rental",
    "class pass", "day pass", "facility", "booking", "bookings",
  ],
};

const BLEND_THRESHOLD_RATIO = 0.7; // if 2nd-best score >= 70% of the best, blend

// Explicit, documented tiebreak — used ONLY when two templates score
// exactly equal. Previously ties resolved via Object.keys() insertion
// order, an implicit accident (found via the makerspace fixture: ecommerce
// beat local 1-1 purely because it's declared first in KEYWORDS). Narrower,
// higher-signal templates rank above broad catch-alls here, since an exact
// tie usually means the idea only matched generic words shared across
// templates rather than either template's real signal.
const TIEBREAK_PRIORITY: BusinessTemplateId[] = [
  "saas", "content", "physical-space", "local", "service", "ecommerce",
];

function tiebreakRank(id: BusinessTemplateId): number {
  const idx = TIEBREAK_PRIORITY.indexOf(id);
  return idx === -1 ? TIEBREAK_PRIORITY.length : idx;
}

// Partial, not InterviewAnswers: template selection only ever reads
// whatCustomersPayFor/howDeliveryReaches/stage (see below), so it's safe —
// and needed — to call this on just the 5-question spine, before branch or
// context questions are answered, to decide which template's branch
// questions to show next (getInterviewQuestionsForTemplate). pipeline.ts's
// own later call, after every answer is in, benefits from the full object
// but doesn't require it.
export function selectTemplate(idea: string, answers: Partial<InterviewAnswers>): TemplateSelection {
  const haystack = `${idea} ${answers.whatCustomersPayFor ?? ""}`.toLowerCase();

  const scores = Object.fromEntries(
    (Object.keys(KEYWORDS) as BusinessTemplateId[]).map((id) => {
      let score = 0;
      for (const kw of KEYWORDS[id]) {
        if (haystack.includes(kw)) score += 1;
      }
      // Light delivery/stage signal.
      if (id === "local" && answers.howDeliveryReaches === "in-person") score += 1;
      if (id === "physical-space" && answers.howDeliveryReaches === "in-person") score += 1;
      if (id === "saas" && answers.stage === "nothing-yet") score += 0.5;
      return [id, score];
    }),
  ) as Record<BusinessTemplateId, number>;

  const ranked = (Object.entries(scores) as [BusinessTemplateId, number][]).sort(
    (a, b) => b[1] - a[1] || tiebreakRank(a[0]) - tiebreakRank(b[0]),
  );
  const [best, bestScore] = ranked[0];
  const [second, secondScore] = ranked[1];

  const blendedWith = bestScore > 0 && secondScore >= bestScore * BLEND_THRESHOLD_RATIO && secondScore > 0 ? second : null;
  const tie = bestScore === secondScore;

  return { primary: best, blendedWith, scores, tie };
}
