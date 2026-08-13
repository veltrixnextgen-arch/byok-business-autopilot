import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDisambiguationQuestion, getInterviewQuestionsForSelection, getInterviewQuestionsForTemplate } from "./interviewQuestions.js";

test("getInterviewQuestionsForTemplate includes the template's own branch questions", () => {
  const withTemplate = getInterviewQuestionsForTemplate("saas");
  const withoutTemplate = getInterviewQuestionsForTemplate(null);
  assert.ok(withTemplate.length > withoutTemplate.length);
  assert.ok(withTemplate.some((q) => q.id === "buildStage"));
});

test("buildDisambiguationQuestion offers exactly the two given candidates, not a fabricated third", () => {
  const q = buildDisambiguationQuestion(["local", "food-hospitality"]);
  assert.equal(q.id, "templateDisambiguation");
  assert.equal(q.kind, "single-select");
  assert.deepEqual(
    q.options?.map((o) => o.value),
    ["local", "food-hospitality"],
  );
  // Real template name/description, not a fabricated label — the
  // founder needs to recognize their own business in these options.
  for (const opt of q.options ?? []) {
    assert.ok(opt.label.length > 0);
  }
});

// The whole point of surfacing ambiguity as a question instead of a
// silent guess: while it's unresolved, show the disambiguation question
// in place of branch questions — asking one template's branch questions
// before we know which template applies would just be guessing dressed
// up as a question.
test("getInterviewQuestionsForSelection shows the disambiguation question instead of branch questions when needed", () => {
  const questions = getInterviewQuestionsForSelection("local", {
    needed: true,
    candidates: ["local", "food-hospitality"],
  });
  assert.ok(questions.some((q) => q.id === "templateDisambiguation"));
  // Neither candidate's own branch questions should appear yet.
  assert.ok(!questions.some((q) => q.id === "staffing")); // local's branch question
  assert.ok(!questions.some((q) => q.id === "productionModel")); // food-hospitality's
});

test("getInterviewQuestionsForSelection falls back to the normal template branch questions once resolved", () => {
  const questions = getInterviewQuestionsForSelection("food-hospitality", null);
  assert.ok(!questions.some((q) => q.id === "templateDisambiguation"));
  assert.ok(questions.some((q) => q.id === "productionModel"));
});
