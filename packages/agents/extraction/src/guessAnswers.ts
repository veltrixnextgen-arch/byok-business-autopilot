import type { InterviewAnswers } from "./types.js";

export type SpineGuess = Partial<Pick<InterviewAnswers, "whoTheCustomerIs" | "howMoneyArrives" | "howDeliveryReaches">>;

// Pre-fills a few spine answers from the idea text, visibly marked as a
// guess in the UI ("we read your idea as X — confirm or correct"), never
// silently applied. Deliberately a keyword heuristic, not an LLM call —
// the onboarding batch's platform spend is capped (ADR-003) for the real
// extraction work; spending part of that budget just to pre-fill a
// correctable guess isn't worth it. Only sets a field when a keyword
// clearly hits — an empty/ambiguous idea returns an empty object rather
// than a low-confidence guess dressed up as a real one.
export function guessAnswersFromIdea(idea: string): SpineGuess {
  const text = idea.toLowerCase();
  const guess: SpineGuess = {};

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
