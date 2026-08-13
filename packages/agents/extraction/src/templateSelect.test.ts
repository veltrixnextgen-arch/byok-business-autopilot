import { test } from "node:test";
import assert from "node:assert/strict";
import { selectTemplate } from "./templateSelect.js";

// The meal-prep incident (docs/DECISIONS.md): "a subscription-based meal
// prep company in Vancouver" got routed to saas because "subscription"
// was a saas keyword, despite howMoneyArrives already capturing that
// fact structurally. This is the regression guard — the exact idea text
// and structured answers from that real run must never again resolve to
// saas, or any template with no food-hospitality signal.
test("a subscription meal-prep idea does not route to saas — the exact incident this file exists to prevent", () => {
  const result = selectTemplate("A subscription meal-prep service in Vancouver — we cook fresh meals every week and deliver them to homes.", {
    whatCustomersPayFor: "Fresh, healthy, ready-to-eat meals delivered to your door every week",
    howMoneyArrives: "subscription",
    howDeliveryReaches: "shipped",
    stage: "nothing-yet",
  });
  assert.notEqual(result.primary, "saas");
  assert.equal(result.primary, "food-hospitality");
  assert.equal(result.confidence, "high");
});

// The structured-answer redesign's whole point: an explicit answer must
// outweigh a handful of stray keyword hits elsewhere in free text, not
// the other way around.
test("a structured answer outweighs unrelated keyword hits in free text", () => {
  // "app" and "tool" both hit the saas keyword list, but the founder
  // explicitly said their delivery is physical goods shipped to a
  // customer — that structured fact must win.
  const result = selectTemplate("I built a little tool that helps me run my candle shop, kind of like an app for my orders.", {
    howDeliveryReaches: "shipped",
  });
  assert.equal(result.primary, "ecommerce");
});

// Business-model words (subscription, membership, recurring) must never
// carry template signal on their own — that's exactly the leak this file
// was rewritten to close. An idea with a payment-model word and nothing
// else shouldn't confidently resolve to any one template.
test("a bare payment-model word with no business-type signal doesn't confidently pick a template", () => {
  const result = selectTemplate("We run on a subscription model.", {
    howMoneyArrives: "subscription",
  });
  assert.equal(result.confidence, "low");
});

// howMoneyArrives itself must never appear as a per-template bonus —
// payment model doesn't predict business type. Every template should
// score identically (zero) from this answer alone.
test("howMoneyArrives never contributes a template-specific bonus", () => {
  const subscription = selectTemplate("a generic idea with no other signal", { howMoneyArrives: "subscription" });
  const oneTime = selectTemplate("a generic idea with no other signal", { howMoneyArrives: "one-time" });
  assert.deepEqual(subscription.scores, oneTime.scores);
});

// The regression this exact fix caught mid-implementation: "in-person"
// is ambiguous between local and physical-space, but must NOT touch
// food-hospitality — a wedding photographer (in-person delivery, zero
// food keywords) must not tie with a narrow food-specific category just
// because delivery happens to be in-person.
test("an in-person, non-food idea never picks up food-hospitality signal", () => {
  const result = selectTemplate("I'm a wedding photographer who also sells editing courses online.", {
    howDeliveryReaches: "in-person",
  });
  assert.equal(result.scores["food-hospitality"], 0);
});

// Confidence signal (the makerspace/meal-prep coin-flip case): the top
// two candidates scoring the same should be reported as low confidence,
// not silently resolved via the tiebreak as if it were a clean win.
test("an exact tie between the top two candidates is reported as low confidence", () => {
  const result = selectTemplate("a coworking studio space with a small retail shop up front", {});
  assert.ok(result.blendedWith !== null || result.tie, "expected this to be genuinely ambiguous");
  assert.equal(result.confidence, "low");
});

// Founder disambiguation (interviewQuestions.ts's buildDisambiguationQuestion)
// always wins outright, regardless of what the scores say — this is an
// explicit human answer, not another signal to weigh.
test("an explicit templateDisambiguation answer overrides scoring entirely", () => {
  const result = selectTemplate("a coworking studio space with a small retail shop up front", {
    branchAnswers: { templateDisambiguation: "ecommerce" },
  });
  assert.equal(result.primary, "ecommerce");
  assert.equal(result.blendedWith, null);
  assert.equal(result.confidence, "high");
});

test("an unrecognized templateDisambiguation value is ignored, not trusted blindly", () => {
  const result = selectTemplate("a coworking studio space", {
    branchAnswers: { templateDisambiguation: "not-a-real-template" },
  });
  assert.notEqual(result.primary, "not-a-real-template");
});

// A clean, unambiguous case should stay confident — the redesign must
// not make every selection look uncertain.
test("a clearly signaled idea resolves with high confidence", () => {
  const result = selectTemplate("A SaaS tool for scheduling social media posts, nothing built yet.", {
    howDeliveryReaches: "software-saas",
  });
  assert.equal(result.primary, "saas");
  assert.equal(result.confidence, "high");
});
