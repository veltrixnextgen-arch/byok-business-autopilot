import type { InterviewAnswers } from "./types.js";

export type SpineGuess = Partial<Pick<InterviewAnswers, "whatCustomersPayFor" | "whoTheCustomerIs" | "howMoneyArrives" | "howDeliveryReaches">>;

// Pre-fills a few spine answers from the idea text, visibly marked as a
// guess in the UI ("we read your idea as X — confirm or correct"), never
// silently applied. Deliberately a keyword heuristic, not an LLM call —
// the onboarding batch's platform spend is capped (ADR-003) for the real
// extraction work; spending part of that budget just to pre-fill a
// correctable guess isn't worth it. Only sets a field when a keyword
// clearly hits — an empty/ambiguous idea returns an empty object rather
// than a low-confidence guess dressed up as a real one.
//
// whatCustomersPayFor is the one exception to "only on a clear keyword
// hit": it's free text, not an enum, so there's no keyword to match
// against — the idea description itself IS the founder's own answer to
// "what do customers pay you for" in the large majority of real
// descriptions ("a subscription meal-prep company in Vancouver" already
// reads as an answer to that question). Using it verbatim as the guess
// is the same non-LLM, always-correctable, never-fabricated commitment
// as every other guess here — it's just re-showing the user their own
// words instead of a derived keyword, not inventing new claims about
// their business.
export function guessAnswersFromIdea(idea: string): SpineGuess {
  const trimmedIdea = idea.trim();
  const text = idea.toLowerCase();
  const guess: SpineGuess = {};

  if (trimmedIdea) {
    guess.whatCustomersPayFor = trimmedIdea;
  }

  if (/\b(software|saas|app|platform|web ?app|dashboard|api)\b/.test(text)) {
    guess.howDeliveryReaches = "software-saas";
  } else if (/\b(ship|shipping|courier|mail order|etsy|shopify|marketplace|handmade)\b/.test(text)) {
    guess.howDeliveryReaches = "shipped";
  } else if (/\b(in-?person|studio|salon|gym|storefront|cafe|coffee shop|space|makerspace|coworking)\b/.test(text)) {
    guess.howDeliveryReaches = "in-person";
  } else if (/\b(download|ebook|course|preset|digital|newsletter|podcast)\b/.test(text)) {
    guess.howDeliveryReaches = "online";
  }

  if (/\b(businesses|b2b|companies|enterprise|clients' companies)\b/.test(text)) {
    guess.whoTheCustomerIs = "businesses";
  } else if (/\b(customers|consumers|shoppers|people)\b/.test(text)) {
    guess.whoTheCustomerIs = "consumers";
  }

  if (/\b(subscription|monthly|membership|recurring)\b/.test(text)) {
    guess.howMoneyArrives = "subscription";
  } else if (/\b(invoice|invoicing|per-?project|retainer)\b/.test(text)) {
    guess.howMoneyArrives = "invoiced-projects";
  } else if (/\b(sell|buy|purchase|shop)\b/.test(text)) {
    guess.howMoneyArrives = "one-time";
  }

  return guess;
}
