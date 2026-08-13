import { test } from "node:test";
import assert from "node:assert/strict";
import { guessAnswersFromIdea } from "./guessAnswers.js";

// The Q1 pre-fill bug: whatCustomersPayFor never got guessed because the
// return type structurally excluded it. This is the regression guard —
// any non-empty idea must yield a whatCustomersPayFor guess.
test("guesses whatCustomersPayFor from the idea text verbatim", () => {
  const result = guessAnswersFromIdea("A subscription meal-prep company in Vancouver.");
  assert.equal(result.whatCustomersPayFor, "A subscription meal-prep company in Vancouver.");
});

test("trims whitespace but never fabricates a guess for an empty idea", () => {
  assert.deepEqual(guessAnswersFromIdea(""), {});
  assert.deepEqual(guessAnswersFromIdea("   "), {});
});

test("guesses howMoneyArrives from a clear subscription/recurring keyword", () => {
  const result = guessAnswersFromIdea("A monthly subscription box for coffee lovers.");
  assert.equal(result.howMoneyArrives, "subscription");
});

test("guesses howDeliveryReaches from a clear software keyword", () => {
  const result = guessAnswersFromIdea("A SaaS platform for scheduling social media posts.");
  assert.equal(result.howDeliveryReaches, "software-saas");
});

test("guesses whoTheCustomerIs from a clear B2B keyword", () => {
  const result = guessAnswersFromIdea("Consulting services for enterprise companies.");
  assert.equal(result.whoTheCustomerIs, "businesses");
});

test("an ambiguous idea with no clear keyword leaves the enum-based guesses unset, not a low-confidence guess dressed up as real", () => {
  const result = guessAnswersFromIdea("I have a business idea.");
  assert.equal(result.howMoneyArrives, undefined);
  assert.equal(result.howDeliveryReaches, undefined);
  assert.equal(result.whoTheCustomerIs, undefined);
});
