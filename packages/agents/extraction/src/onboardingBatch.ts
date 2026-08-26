import Anthropic from "@anthropic-ai/sdk";
import type { Charter, InterviewAnswers, OnboardingBatch, OrgChart, SimulatedDayCard } from "./types.js";
import { actualCostUsd, guardEstimatedCost } from "./costGuard.js";

// master-plan-v2.md §4 (Phase A): the Task Extraction Engine "also emits the
// simulated-day script and Charter draft from the same batch" — i.e. the
// same capped per-signup spend envelope as the org chart (ADR-003), not a
// separate paid feature. This runs as one additional call AFTER assembly,
// since both outputs need the FINAL team/sub-agent structure (not just the
// customized task list) to be coherent.
//
// Model: haiku, not sonnet. This is formatting/synthesis over an
// already-extracted org chart (narrate the existing tasks as a digest and a
// charter), not fresh reasoning — verified via a 2-fixture, both-models
// experiment (see test/results/haiku-batch-experiment.md): ~4x cheaper
// ($0.008 vs $0.03/call) with comparable quality once the prompt explicitly
// banned "Label: task" prefixing (haiku's one real style tic — fixed below).
export const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
// Issue #124: 3000 was never stress-tested against a real-sized org chart.
// A 20-task/17-agent e-commerce company hit stop_reason=max_tokens at
// exactly 3000/3000, truncating the tool call mid-output (missing
// simulatedDay/charterDraft) — pipeline.ts's graceful-degradation path
// catches that and leaves onboardingBatch null, which is silently fatal
// downstream: charter.ts's POST /me/charter/draft seeds the draft from
// exactly this field, so a tenant whose org chart is large enough can
// never draft or accept a Charter at all. Output length scales with
// company size (one simulatedDay card + one charterDraft entry per
// role/task), so the ceiling needs real headroom, not just enough for
// the smallest possible chart. $0.25/signup (DEFAULT_MAX_COST_USD) has
// ample room even at this size — Haiku's per-token cost is small enough
// that this alone was never the binding constraint.
const MAX_OUTPUT_TOKENS = 8000;

// R2 (ADR-024): the Charter's budget ceiling is resolved deterministically,
// never LLM-guessed — the interview doesn't collect a budget figure, and
// asking the model to invent a dollar amount would produce a number with no
// relationship to what actually gets enforced. This is the SAME default the
// cost gate itself uses (apps/api/src/routes/ceiling.ts's
// DEFAULT_MONTHLY_CEILING_USD = 50) — duplicated here rather than imported
// because packages/agents/extraction correctly has no dependency on apps/api
// (the platform-key onboarding batch has to work before any tenant or
// tenant-scoped route exists — ADR-015). Keep these two constants in sync by
// hand; a mismatch would make the Charter's stated ceiling a lie about what
// actually gates spend.
const DEFAULT_CHARTER_BUDGET_CEILING_USD = 50;

// Issue #124: this used to be swallowed by pipeline.ts's graceful
// degradation, same as a budget shortfall — but a truncated/malformed
// response here isn't a cost-safety tradeoff, it's a real failure, and
// this output is load-bearing downstream (charter.ts seeds the Charter
// draft from it). A dedicated, plain-language error, not a bare
// `new Error(...)`, so whoever eventually reads batch.error — today
// that's the raw message the extraction-batch UI shows verbatim — sees
// something they can act on, not an internal tool-call description.
class OnboardingBatchIncompleteError extends Error {
  constructor(reason: string) {
    super(`We couldn't finish setting up your company — ${reason} Please try again.`);
    this.name = "OnboardingBatchIncompleteError";
  }
}

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
            agentId: { type: "string", description: "Must exactly match an agents[].id from the org chart provided." },
            roleTitle: { type: "string", description: "The team's role title this agent reports to, e.g. 'CFO'." },
            summary: {
              type: "string",
              description: "One plain-language line: what they did today, in the style 'prepared 2 invoices for your approval'.",
            },
          },
          required: ["agentId", "roleTitle", "summary"],
        },
      },
      charterDraft: {
        type: "object",
        description:
          "Per userflow-v2 Stage 4, Screen 10 (R2/ADR-024): idea -> MVP definition -> every role's mandate and tasks -> month-one goals. " +
          "Budget ceiling is NOT part of this schema — it's resolved deterministically after this call, not guessed by the model.",
        properties: {
          sharpenedIdea: { type: "string", description: "The idea restated crisply, one or two sentences." },
          mvpDefinition: {
            type: "string",
            description: "What version 1 of this business actually is, scoped to be launchable — a short paragraph.",
          },
          roleMandates: {
            type: "array",
            description: "Every role in the org chart, with its mandate and its tasks summarized in plain language.",
            items: {
              type: "object",
              properties: {
                roleTitle: { type: "string" },
                mandate: {
                  type: "string",
                  description:
                    "One or two sentences: what this role is trusted to decide and act on without asking, and where its " +
                    "authority stops (e.g. 'Keeps invoices current and flags anomalies — never sends a payment reminder " +
                    "without approval'). Not a repeat of the tasks list — the boundary of its judgment.",
                },
                tasks: { type: "array", items: { type: "string" } },
              },
              required: ["roleTitle", "mandate", "tasks"],
            },
          },
          monthOneGoals: {
            type: "array",
            items: { type: "string" },
            description: "3-5 concrete, plain-language goals for the first month.",
          },
        },
        required: ["sharpenedIdea", "mvpDefinition", "roleMandates", "monthOneGoals"],
      },
    },
    required: ["simulatedDay", "charterDraft"],
  },
};

function buildPrompt(chart: OrgChart, idea: string, answers: InterviewAnswers): string {
  const teamLines = chart.teams
    .map((team) => {
      const agents = team.agentIds.map((id) => chart.agents.find((a) => a.id === id)!);
      return (
        `${team.roleTitle}${team.isHuman ? " (human — the user, not an agent)" : ""}:\n` +
        agents
          .map((a) => {
            const tasks = a.taskIds.map((tid) => chart.tasks.find((t) => t.id === tid)!.text);
            return `  - ${a.name} · ${a.title} (id: ${a.id}): ${tasks.join("; ")}`;
          })
          .join("\n")
      );
    })
    .join("\n\n");

  return [
    `Business idea: "${idea}"`,
    `What customers pay for: ${answers.whatCustomersPayFor}`,
    ``,
    `The assembled org chart for this company (each agent's name is already assigned — use it exactly as given, never invent a different one):`,
    teamLines,
    ``,
    `Generate the onboarding batch for this company:`,
    `1. simulatedDay: 3-5 cards. Pick a spread across different (non-human) teams, not all from one team. ` +
      `Use each agent's name exactly as given above — do not invent a different one. Keep each summary ` +
      `concrete and specific to this company's actual tasks, not generic filler.`,
    `2. charterDraft: cover every non-human team from the org chart in roleMandates (skip the Founder/CEO team — ` +
      `that's the human, not a role to summarize). Keep the MVP definition scoped to what's actually launchable, ` +
      `not the whole long-term vision. Each role's mandate is a boundary statement (what it decides alone, where ` +
      `it stops), not a restatement of its task list.`,
    `3. Write every roleMandates.tasks entry as natural plain-language prose — do NOT prefix it with the agent's ` +
      `category label. Write "Track stock levels for each product and flag reorder points" not "Inventory: ` +
      `Track stock levels...". No internal jargon or label:value formatting anywhere in the charter.`,
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
  model: string = CLAUDE_MODEL,
): Promise<OnboardingBatchResult> {
  const prompt = buildPrompt(chart, idea, answers);

  guardEstimatedCost(model, prompt, MAX_OUTPUT_TOKENS, maxCostUsd);

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    tools: [ONBOARDING_BATCH_TOOL],
    tool_choice: { type: "tool", name: "generate_onboarding_batch" },
    messages: [{ role: "user", content: prompt }],
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = actualCostUsd(model, inputTokens, outputTokens);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a generate_onboarding_batch tool call.");
  }

  const input = toolUse.input as {
    simulatedDay?: Omit<SimulatedDayCard, "agentName">[];
    charterDraft?: Omit<Charter, "budgetCeilingUsd">;
  };
  if (!input.simulatedDay || !input.charterDraft) {
    console.error(`[onboarding-batch] stop_reason=${response.stop_reason}, outputTokens=${outputTokens}/${MAX_OUTPUT_TOKENS}`);
    const reason =
      response.stop_reason === "max_tokens"
        ? "the response was too long to finish."
        : "the response came back incomplete.";
    throw new OnboardingBatchIncompleteError(reason);
  }

  // Defensive: drop any card that references an agent id not actually in
  // this chart (a hallucinated id would break downstream UI linking), and
  // always fill agentName from the chart's own canonical Agent.name rather
  // than trusting the model to have echoed it back correctly — names must
  // stay identical everywhere downstream (userflow-v2.md: "Names flow
  // through everything downstream: digest, approval queue, dashboard").
  const agentsById = new Map(chart.agents.map((a) => [a.id, a]));
  const simulatedDay: SimulatedDayCard[] = input.simulatedDay
    .filter((card) => agentsById.has(card.agentId))
    .map((card) => ({ ...card, agentName: agentsById.get(card.agentId)!.name }));

  const charterDraft: Charter = { ...input.charterDraft, budgetCeilingUsd: DEFAULT_CHARTER_BUDGET_CEILING_USD };

  return {
    batch: { simulatedDay, charterDraft },
    usage: { step: "onboarding-batch", model, inputTokens, outputTokens, costUsd },
  };
}
