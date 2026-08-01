import Anthropic from "@anthropic-ai/sdk";
import type { CharterDraft, InterviewAnswers, OnboardingBatch, OrgChart, SimulatedDayCard } from "./types.js";
import { actualCostUsd, guardEstimatedCost } from "./costGuard.js";

// master-plan-v2.md §4 (Phase A): the Task Extraction Engine "also emits the
// simulated-day script and Charter draft from the same batch" — i.e. the
// same capped per-signup spend envelope as the org chart (ADR-003), not a
// separate paid feature. This runs as one additional call AFTER assembly,
// since both outputs need the FINAL team/sub-agent structure (not just the
// customized task list) to be coherent.
export const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 1800;

const ONBOARDING_BATCH_TOOL = {
  name: "generate_onboarding_batch",
  description:
    "Generate the simulated first-day digest and the Company Charter draft for this specific company, " +
    "from its already-assembled org chart.",
  input_schema: {
    type: "object" as const,
    properties: {
      simulatedDay: {
        type: "array",
        description:
          "3-5 plausible completed-task cards for a mock morning digest, per userflow-v2 Stage 2 Screen 6 " +
          "(e.g. 'Alex prepared 2 invoices for your approval'). Illustrative only — no real execution happened.",
        items: {
          type: "object",
          properties: {
            agentName: { type: "string", description: "A friendly first name for this sub-agent, auto-suggested (editable later)." },
            subAgentId: { type: "string", description: "Must exactly match a subAgents[].id from the org chart provided." },
            roleTitle: { type: "string", description: "The team's role title this sub-agent reports to, e.g. 'CFO'." },
            summary: {
              type: "string",
              description: "One plain-language line: what they did today, in the style 'prepared 2 invoices for your approval'.",
            },
          },
          required: ["agentName", "subAgentId", "roleTitle", "summary"],
        },
      },
      charterDraft: {
        type: "object",
        description: "Per userflow-v2 Stage 4, Screen 10: idea -> MVP definition -> every role's tasks -> month-one goals -> budget ceiling.",
        properties: {
          sharpenedIdea: { type: "string", description: "The idea restated crisply, one or two sentences." },
          mvpDefinition: {
            type: "string",
            description: "What version 1 of this business actually is, scoped to be launchable — a short paragraph.",
          },
          roleTasks: {
            type: "array",
            description: "Every role in the org chart, with its tasks summarized in plain language.",
            items: {
              type: "object",
              properties: {
                roleTitle: { type: "string" },
                tasks: { type: "array", items: { type: "string" } },
              },
              required: ["roleTitle", "tasks"],
            },
          },
          monthOneGoals: {
            type: "array",
            items: { type: "string" },
            description: "3-5 concrete, plain-language goals for the first month.",
          },
          budgetCeilingPlaceholder: {
            type: "string",
            description: "A placeholder monthly ceiling statement derived from the interview's budget answer, e.g. '$25/month (from your interview answer — adjust anytime)'.",
          },
        },
        required: ["sharpenedIdea", "mvpDefinition", "roleTasks", "monthOneGoals", "budgetCeilingPlaceholder"],
      },
    },
    required: ["simulatedDay", "charterDraft"],
  },
};

function buildPrompt(chart: OrgChart, idea: string, answers: InterviewAnswers): string {
  const teamLines = chart.teams
    .map((team) => {
      const subAgents = team.subAgentIds.map((id) => chart.subAgents.find((s) => s.id === id)!);
      return (
        `${team.roleTitle}${team.isHuman ? " (human — the user, not an agent)" : ""}:\n` +
        subAgents
          .map((s) => {
            const tasks = s.taskIds.map((tid) => chart.tasks.find((t) => t.id === tid)!.text);
            return `  - ${s.label} (id: ${s.id}): ${tasks.join("; ")}`;
          })
          .join("\n")
      );
    })
    .join("\n\n");

  return [
    `Business idea: "${idea}"`,
    `Business type: ${answers.businessType}`,
    `Interview budget answer: ${answers.budget}`,
    ``,
    `The assembled org chart for this company:`,
    teamLines,
    ``,
    `Generate the onboarding batch for this company:`,
    `1. simulatedDay: 3-5 cards. Pick a spread across different (non-human) teams, not all from one team. ` +
      `Invent a friendly first name per sub-agent (these are illustrative suggestions, fully editable later — ` +
      `don't worry about consistency with any other naming). Keep each summary concrete and specific to this ` +
      `company's actual tasks, not generic filler.`,
    `2. charterDraft: cover every non-human team from the org chart in roleTasks (skip the Founder/CEO team — ` +
      `that's the human, not a role to summarize). Keep the MVP definition scoped to what's actually launchable, ` +
      `not the whole long-term vision. budgetCeilingPlaceholder should read the interview's budget answer above ` +
      `and phrase it as a starting monthly ceiling.`,
  ].join("\n");
}

export interface OnboardingBatchResult {
  batch: OnboardingBatch;
  usage: { step: "onboarding-batch"; model: string; inputTokens: number; outputTokens: number; costUsd: number };
}

export async function generateOnboardingBatch(
  chart: OrgChart,
  idea: string,
  answers: InterviewAnswers,
  apiKey: string,
  maxCostUsd: number,
): Promise<OnboardingBatchResult> {
  const prompt = buildPrompt(chart, idea, answers);

  guardEstimatedCost(CLAUDE_MODEL, prompt, MAX_OUTPUT_TOKENS, maxCostUsd);

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    tools: [ONBOARDING_BATCH_TOOL],
    tool_choice: { type: "tool", name: "generate_onboarding_batch" },
    messages: [{ role: "user", content: prompt }],
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = actualCostUsd(CLAUDE_MODEL, inputTokens, outputTokens);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a generate_onboarding_batch tool call.");
  }

  const input = toolUse.input as { simulatedDay?: SimulatedDayCard[]; charterDraft?: CharterDraft };
  if (!input.simulatedDay || !input.charterDraft) {
    throw new Error("generate_onboarding_batch tool call was missing simulatedDay or charterDraft.");
  }

  // Defensive: drop any card that references a sub-agent id not actually in
  // this chart (a hallucinated id would break downstream UI linking).
  const validSubAgentIds = new Set(chart.subAgents.map((s) => s.id));
  const simulatedDay = input.simulatedDay.filter((card) => validSubAgentIds.has(card.subAgentId));

  return {
    batch: { simulatedDay, charterDraft: input.charterDraft },
    usage: { step: "onboarding-batch", model: CLAUDE_MODEL, inputTokens, outputTokens, costUsd },
  };
}
