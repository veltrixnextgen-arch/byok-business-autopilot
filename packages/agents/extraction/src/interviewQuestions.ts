import { allTemplates, type BusinessTemplateId } from "@byok/templates";
import { getContextQuestions, getSpineQuestions, type InterviewQuestion } from "@byok/contracts";

// The full question set for a given idea, in the order the interview
// actually asks them: the 5-question universal spine (always), then the
// template's own branchQuestions (0-3, once selectTemplate has narrowed to
// one — see templateSelect.ts, which is safe to call on just the spine
// answers), then the 2 universal context questions. Adding a template's
// branch questions is a change to that template file alone
// (packages/templates/src/*.ts) — this function needs zero changes, and
// neither does apps/web, which just renders whatever this returns.
export function getInterviewQuestionsForTemplate(templateId?: BusinessTemplateId | null): InterviewQuestion[] {
  const branch = templateId ? allTemplates[templateId].branchQuestions : [];
  return [...getSpineQuestions(), ...branch, ...getContextQuestions()];
}

// Injected in place of branch questions when template selection is
// ambiguous (TemplateSelection.confidence === "low" — the makerspace/
// meal-prep coin-flip case) and the founder hasn't already resolved it.
// Answering this pins the template directly: it isn't a spine or context
// question id, so InterviewScreen.tsx's own buildFullAnswers already
// buckets it into branchAnswers automatically (same as any other branch
// question) — selectTemplate checks branchAnswers.templateDisambiguation
// as a direct override. No client-side change needed for this to work;
// the UI already renders any single-select question generically.
export function buildDisambiguationQuestion(candidates: [BusinessTemplateId, BusinessTemplateId]): InterviewQuestion {
  return {
    id: "templateDisambiguation",
    prompt: "Which of these sounds closest to your business?",
    kind: "single-select",
    options: candidates.map((id) => ({
      value: id,
      label: `${allTemplates[id].name} — ${allTemplates[id].description}`,
    })),
  };
}

export interface DisambiguationNeed {
  needed: boolean;
  candidates: [BusinessTemplateId, BusinessTemplateId];
}

// Skips branch questions entirely while ambiguous — showing one
// template's branch questions before we actually know which template
// applies would just be more guessing dressed up as a question. Once
// disambiguation.needed is false (either selection was confident, or the
// founder already answered), this is identical to
// getInterviewQuestionsForTemplate.
export function getInterviewQuestionsForSelection(
  templateHint: BusinessTemplateId | null,
  disambiguation: DisambiguationNeed | null,
): InterviewQuestion[] {
  if (disambiguation?.needed) {
    return [...getSpineQuestions(), buildDisambiguationQuestion(disambiguation.candidates), ...getContextQuestions()];
  }
  return getInterviewQuestionsForTemplate(templateHint);
}
