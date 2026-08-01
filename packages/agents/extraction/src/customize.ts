import Anthropic from "@anthropic-ai/sdk";
import type { BusinessTemplate, TeamHint } from "@byok/templates";
import type { CustomizeResult, InterviewAnswers } from "./types.js";
import { actualCostUsd, guardEstimatedCost } from "./costGuard.js";

export const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 1500;

const TEAM_HINTS: TeamHint[] = [
  "founder", "cfo", "cmo", "support", "sales", "ops", "compliance", "people", "product-dev",
];

const CUSTOMIZE_TOOL = {
  name: "customize_tasks",
  description:
    "Customize a curated business-type task template for one specific idea: add idea-specific tasks, " +
    "remove irrelevant template tasks, and adjust frequencies. Never replace or regenerate the whole list.",
  input_schema: {
    type: "object" as const,
    properties: {
      addTasks: {
        type: "array",
        description: "New, idea-specific tasks not already covered by the template.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Plain-language task description, no jargon." },
            subAgentType: {
              type: "string",
              description:
                "Short kebab-case task-type id this task clusters under (reuse an existing template " +
                "subAgentType if it genuinely fits, otherwise invent a new one).",
            },
            subAgentLabel: { type: "string", description: "Human-readable label for that sub-agent." },
            teamHint: { type: "string", enum: TEAM_HINTS },
            frequency: { type: "string", enum: ["daily", "weekly", "monthly", "adhoc"] },
            stakes: { type: "string", enum: ["low", "medium", "high"] },
            tier: { type: "string", enum: ["T1", "T2", "T3"] },
            autonomy: { type: "string", enum: ["locked", "earnable", "eligible-early"] },
            handsTool: {
              type: ["string", "null"],
              description: "Service API this task will eventually need, or null.",
            },
            rationale: { type: "string", description: "One line: why this idea specifically needs this task." },
          },
          required: [
            "text", "subAgentType", "subAgentLabel", "teamHint", "frequency", "stakes", "tier", "autonomy",
            "handsTool", "rationale",
          ],
        },
      },
      removeTaskIds: {
        type: "array",
        items: { type: "string" },
        description: "IDs of template tasks that do not apply to this specific idea.",
      },
      frequencyAdjustments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            frequency: { type: "string", enum: ["daily", "weekly", "monthly", "adhoc"] },
          },
          required: ["taskId", "frequency"],
        },
      },
      notes: { type: "string", description: "Optional one-line summary of the customization reasoning." },
    },
    required: ["addTasks", "removeTaskIds", "frequencyAdjustments"],
  },
};

function buildPrompt(idea: string, answers: InterviewAnswers, template: BusinessTemplate): string {
  const taskLines = template.tasks
    .map((t) => `- ${t.id} | ${t.subAgentType} | ${t.teamHint} | ${t.frequency} | ${t.text}`)
    .join("\n");

  return [
    `Business idea (verbatim from the user): "${idea}"`,
    ``,
    `Interview answers:`,
    `- Business type (self-described): ${answers.businessType}`,
    `- Who pays: ${answers.whoPays}`,
    `- Channels: ${answers.channels}`,
    `- Current status: ${answers.status}`,
    `- Biggest dread: ${answers.dread}`,
    `- Budget: ${answers.budget}`,
    ``,
    `Selected template: "${template.name}" (${template.id}) — ${template.description}`,
    ``,
    `Template tasks (id | subAgentType | teamHint | frequency | text):`,
    taskLines,
    ``,
    `Customize this template for the idea above. Rules:`,
    `1. Do NOT generate a task list from scratch — only add, remove, or adjust frequency.`,
    `2. Add ONLY tasks this specific idea genuinely needs that the template doesn't already cover.`,
    `3. Remove template tasks that clearly don't apply to this idea.`,
    `4. Adjust frequency only where this idea's cadence is clearly different from the template default.`,
    `5. Keep additions minimal and concrete — this is a lean MVP-0 differentiation test, not a wishlist.`,
  ].join("\n");
}

export interface CustomizeRunResult {
  result: CustomizeResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function runCustomizePass(
  idea: string,
  answers: InterviewAnswers,
  template: BusinessTemplate,
  opts: { apiKey: string; maxCostUsd: number },
): Promise<CustomizeRunResult> {
  const prompt = buildPrompt(idea, answers, template);

  // Pre-flight guard, before spending anything.
  guardEstimatedCost(prompt, MAX_OUTPUT_TOKENS, opts.maxCostUsd);

  const client = new Anthropic({ apiKey: opts.apiKey });

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    tools: [CUSTOMIZE_TOOL],
    tool_choice: { type: "tool", name: "customize_tasks" },
    messages: [{ role: "user", content: prompt }],
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = actualCostUsd(inputTokens, outputTokens);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a customize_tasks tool call.");
  }

  const result = toolUse.input as CustomizeResult;
  return { result, model: CLAUDE_MODEL, inputTokens, outputTokens, costUsd };
}
