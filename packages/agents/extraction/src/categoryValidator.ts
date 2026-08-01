import Anthropic from "@anthropic-ai/sdk";
import type { TeamHint } from "@byok/templates";
import type { ApiCallUsage, CategoryCorrection, OrgChartTask } from "./types.js";
import { actualCostUsd, guardEstimatedCost } from "./costGuard.js";
import { formatCategoryLegend } from "./categoryDefinitions.js";

// Post-pass validation (change #2): the customize pass just self-assigned a
// teamHint to every task it added. This is a single, cheap, batched
// haiku-class call that independently re-checks those assignments against
// the same category definitions and corrects any that conflict — catching
// mistakes like tagging market research as "product-dev" (found in the
// first differentiation-test run) without spending a second sonnet call.
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_OUTPUT_TOKENS = 800;

const TEAM_HINTS: TeamHint[] = [
  "founder", "cfo", "cmo", "support", "sales", "ops", "delivery", "compliance", "people", "product-dev",
];

const VALIDATE_TOOL = {
  name: "validate_categories",
  description:
    "Check each task's assigned category (teamHint) against the category definitions and return a " +
    "correction for any task that is clearly miscategorized. Leave correctly categorized tasks alone.",
  input_schema: {
    type: "object" as const,
    properties: {
      corrections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            correctedTeamHint: { type: "string", enum: TEAM_HINTS },
            reason: { type: "string", description: "One line: why the original assignment was wrong." },
          },
          required: ["taskId", "correctedTeamHint", "reason"],
        },
      },
    },
    required: ["corrections"],
  },
};

function buildPrompt(tasks: OrgChartTask[]): string {
  const taskLines = tasks.map((t) => `- ${t.id} | assigned: ${t.teamHint} | "${t.text}"`).join("\n");
  return [
    `Category definitions:`,
    formatCategoryLegend(),
    ``,
    `Tasks to check (id | assigned category | text):`,
    taskLines,
    ``,
    `For each task, check whether its assigned category is the single best fit per the definitions above.`,
    `Only return a correction for tasks that are clearly miscategorized — do not "improve" borderline-but-` +
      `defensible calls, and do not return anything for tasks that are already correct.`,
  ].join("\n");
}

export interface ValidateRunResult {
  corrections: CategoryCorrection[];
  usage: ApiCallUsage;
}

export async function validateCategories(
  tasks: OrgChartTask[],
  apiKey: string,
  maxCostUsd: number,
): Promise<ValidateRunResult> {
  if (tasks.length === 0) {
    return { corrections: [], usage: { step: "category-validate", model: HAIKU_MODEL, inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  }

  const prompt = buildPrompt(tasks);

  // Pre-flight guard against whatever budget remains after the customize
  // pass — throws CostGuardError, which the caller treats as "skip this
  // quality pass" rather than a fatal error (see pipeline.ts).
  guardEstimatedCost(HAIKU_MODEL, prompt, MAX_OUTPUT_TOKENS, maxCostUsd);

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    tools: [VALIDATE_TOOL],
    tool_choice: { type: "tool", name: "validate_categories" },
    messages: [{ role: "user", content: prompt }],
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = actualCostUsd(HAIKU_MODEL, inputTokens, outputTokens);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a validate_categories tool call.");
  }

  // Defensive: same as customize.ts — "required" in the tool schema isn't
  // hard-enforced by the API against the model's actual output.
  const raw =
    (toolUse.input as { corrections?: { taskId: string; correctedTeamHint: TeamHint; reason: string }[] })
      .corrections ?? [];

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const corrections: CategoryCorrection[] = [];
  for (const c of raw) {
    const task = byId.get(c.taskId);
    if (!task || task.teamHint === c.correctedTeamHint) continue; // unknown id or no-op
    corrections.push({ taskId: c.taskId, from: task.teamHint, to: c.correctedTeamHint, reason: c.reason });
  }

  return {
    corrections,
    usage: { step: "category-validate", model: HAIKU_MODEL, inputTokens, outputTokens, costUsd },
  };
}
