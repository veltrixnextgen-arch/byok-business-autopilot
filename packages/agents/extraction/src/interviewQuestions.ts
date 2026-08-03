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
