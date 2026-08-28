export { extractOrgChart } from "./pipeline.js";
export type { ExtractOptions } from "./pipeline.js";
export { printTree } from "./treePrinter.js";
export { selectTemplate } from "./templateSelect.js";
export { buildDisambiguationQuestion, getInterviewQuestionsForSelection, getInterviewQuestionsForTemplate } from "./interviewQuestions.js";
export type { DisambiguationNeed } from "./interviewQuestions.js";
export { findJurisdictionCoverage, formatJurisdictionPolicy } from "./jurisdictionPolicy.js";
export { assembleOrgChart, ComplianceMetadataError, HandsScopeViolationError } from "./assemble.js";
export { guessAnswersFromIdea } from "./guessAnswers.js";
export type { SpineGuess } from "./guessAnswers.js";
export { generateCascade } from "./cascade.js";
export { diffTaskLists, customizationLogToDeltas } from "./taskDeltas.js";
export type { TaskDelta, TaskDeltaKind } from "./taskDeltas.js";

// Model ids each internal call uses — aliased since customize.ts and
// onboardingBatch.ts both name their own constant CLAUDE_MODEL (correct
// within each file; only a barrel needs them disambiguated). This is the
// single source of truth apps/api's pricing-table coverage test checks
// against — see apps/api/src/dev/devTrustCore.test.ts.
export { CLAUDE_MODEL as CUSTOMIZE_MODEL } from "./customize.js";
export { HAIKU_MODEL as VALIDATE_MODEL } from "./categoryValidator.js";
export { CLAUDE_MODEL as ONBOARDING_MODEL } from "./onboardingBatch.js";
export { WEBSITE_SUMMARY_MODEL } from "./websiteSummary.js";

export { summarizeWebsite } from "./websiteSummary.js";
export type { WebsiteSummaryResult } from "./websiteSummary.js";
export { fetchWebsiteText, UnsafeWebsiteUrlError, WebsiteFetchTimeoutError, WebsiteFetchFailedError } from "./websiteFetch.js";
export type { FetchWebsiteTextResult } from "./websiteFetch.js";

export type {
  Agent,
  ApiCallUsage,
  BrainRecommendation,
  CategoryCorrection,
  CeoPrompt,
  Charter,
  CharterStatus,
  CompanyCharter,
  CustomizationLog,
  InterviewAnswers,
  InterviewQuestion,
  InterviewQuestionKind,
  InterviewQuestionOption,
  OnboardingBatch,
  OrgChart,
  PromptCascade,
  PromptTier,
  RoleLeadPrompt,
  RoleMandate,
  SimulatedDayCard,
  SubAgentPrompt,
  Task,
  Team,
  TemplateSelection,
} from "./types.js";
