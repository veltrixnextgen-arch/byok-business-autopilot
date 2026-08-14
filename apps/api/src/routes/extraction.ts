import { zValidator } from "@hono/zod-validator";
import type { SignupExtractionBatchStore } from "@byok/db";
import { assembleOrgChart, getInterviewQuestionsForSelection, guessAnswersFromIdea, selectTemplate } from "@byok/extraction";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { runExtractionBatch, type RunExtractionBatchDeps } from "../extraction/runExtractionBatch.js";

const jurisdictionSchema = z.object({
  country: z.string().min(1),
  stateOrProvince: z.string().optional(),
});

const whoTheCustomerIsSchema = z.enum(["consumers", "businesses", "both"]);
const howMoneyArrivesSchema = z.enum(["one-time", "subscription", "invoiced-projects", "not-sure"]);
const howDeliveryReachesSchema = z.enum(["online", "shipped", "in-person", "software-saas", "not-sure"]);
const stageSchema = z.enum(["nothing-yet", "side-project", "live-business"]);
const whoIsWorkingOnItSchema = z.enum(["solo", "me-plus-cofounder", "small-team-already"]);

const partialAnswersSchema = z.object({
  whatCustomersPayFor: z.string().optional(),
  whoTheCustomerIs: whoTheCustomerIsSchema.optional(),
  howMoneyArrives: howMoneyArrivesSchema.optional(),
  howDeliveryReaches: howDeliveryReachesSchema.optional(),
  jurisdiction: jurisdictionSchema.optional(),
  stage: stageSchema.optional(),
  whoIsWorkingOnIt: whoIsWorkingOnItSchema.optional(),
  branchAnswers: z.record(z.string(), z.string()).optional(),
  // Answer to the disambiguation question (interviewQuestions.ts's
  // buildDisambiguationQuestion), sent flat like every other in-progress
  // answer during the interview — not yet nested into branchAnswers,
  // which only happens client-side at final submission
  // (InterviewScreen.tsx's buildFullAnswers). Not part of InterviewAnswers
  // itself (fullAnswersSchema below) — by submission time it's just
  // another branchAnswers entry, same as any template branch question.
  templateDisambiguation: z.string().optional(),
});

const fullAnswersSchema = z.object({
  whatCustomersPayFor: z.string().min(1),
  whoTheCustomerIs: whoTheCustomerIsSchema,
  howMoneyArrives: howMoneyArrivesSchema,
  howDeliveryReaches: howDeliveryReachesSchema,
  jurisdiction: jurisdictionSchema,
  stage: stageSchema,
  whoIsWorkingOnIt: whoIsWorkingOnItSchema,
  branchAnswers: z.record(z.string(), z.string()),
});

const questionsSchema = z.object({
  idea: z.string().min(1),
  answers: partialAnswersSchema.optional(),
});

const startBatchSchema = z.object({
  idea: z.string().min(1),
  answers: fullAnswersSchema,
});

const teamHintSchema = z.enum([
  "founder",
  "cfo",
  "cmo",
  "support",
  "sales",
  "ops",
  "delivery",
  "compliance",
  "people",
  "product-dev",
]);
const frequencySchema = z.enum(["daily", "weekly", "monthly", "adhoc"]);
const stakesSchema = z.enum(["low", "medium", "high"]);
const tierSchema = z.enum(["T1", "T2", "T3"]);
const autonomyDefaultSchema = z.enum(["locked", "earnable", "eligible-early"]);
const handsScopeSchema = z.enum(["own-backoffice", "client-facing"]);
// R3 (ADR-025): scheduling metadata, round-tripped through edit ops
// unchanged (reassemble never recomputes it — see assembleOrgChart, which
// only re-derives Agent/Team clustering from whatever Task[] it's given).
const cadenceSchema = z.enum(["15min", "hourly", "nightly", "daily", "weekly", "monthly"]).nullable();
const triggerTypeSchema = z.enum(["cadence", "event", "threshold"]);

const taskSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  agentType: z.string().min(1),
  agentLabel: z.string().min(1),
  teamHint: teamHintSchema,
  frequency: frequencySchema,
  stakes: stakesSchema,
  tier: tierSchema,
  autonomy: autonomyDefaultSchema,
  autonomyNote: z.string().optional(),
  handsTool: z.string().nullable(),
  handsScope: handsScopeSchema.optional(),
  requiresProfessionalVerification: z.boolean().optional(),
  origin: z.enum(["template", "customize-added"]),
  cadence: cadenceSchema,
  batchable: z.boolean(),
  triggerType: triggerTypeSchema,
});

const reassembleSchema = z.object({ tasks: z.array(taskSchema).min(1) });
const renameAgentSchema = z.object({ agentId: z.string().min(1), name: z.string().min(1) });

export interface ExtractionRouteDeps extends RunExtractionBatchDeps {
  // Widened beyond RunExtractionBatchDeps' own start/complete/fail-only
  // Pick — the read/edit routes need more of the store's surface.
  batchStore: RunExtractionBatchDeps["batchStore"] &
    Pick<SignupExtractionBatchStore, "latestForUser" | "get" | "updateOrgChart">;
}

/**
 * All three routes are behind userMiddleware (auth required, no tenant
 * required — ADR-015): the interview/extraction flow runs before any
 * organization exists. userId always comes from the server-verified
 * session (c.get("userId")), never the request body.
 */
export function extractionRoute(deps: ExtractionRouteDeps) {
  return new Hono<AppEnv>()
    // Recomputed on every call (idea + whatever answers exist so far) so
    // apps/web never has to duplicate template-selection or
    // question-assembly logic — it just renders whatever InterviewQuestion[]
    // comes back. No LLM call: selectTemplate/guessAnswersFromIdea/
    // getInterviewQuestionsForTemplate are all pure, deterministic functions.
    .post("/questions", zValidator("json", questionsSchema), (c) => {
      const { idea, answers } = c.req.valid("json");
      const guess = guessAnswersFromIdea(idea);
      // templateDisambiguation arrives flat (like every other in-progress
      // answer) — selectTemplate's override check reads it from
      // branchAnswers, the shape it'll actually have in the final
      // InterviewAnswers too (InterviewScreen.tsx buckets it there
      // automatically at submission), so this is the one place it needs
      // translating between the two shapes.
      const merged = {
        ...guess,
        ...answers,
        branchAnswers: answers?.templateDisambiguation
          ? { ...(answers.branchAnswers ?? {}), templateDisambiguation: answers.templateDisambiguation }
          : answers?.branchAnswers,
      };
      const selection = selectTemplate(idea, merged);
      const templateHint = selection.scores[selection.primary] > 0 ? selection.primary : null;

      const needsDisambiguation = selection.confidence === "low" && !answers?.templateDisambiguation && selection.blendedWith !== null;
      const questions = getInterviewQuestionsForSelection(
        templateHint,
        needsDisambiguation ? { needed: true, candidates: [selection.primary, selection.blendedWith!] } : null,
      );
      return c.json({ questions, templateHint, guess });
    })
    // Blocks until the batch finishes (or fails/queues/skips) — extraction
    // is a handful of sequential Claude calls, seconds not minutes, so a
    // single request is the simplest correct model. If the client
    // disconnects mid-request (tab closed), this handler keeps running
    // server-side to completion regardless — the DB row is what survives,
    // not the HTTP connection, which is what makes /batches/latest below
    // an actual resume path rather than just a status check.
    .post("/batches", zValidator("json", startBatchSchema), async (c) => {
      const { idea, answers } = c.req.valid("json");
      const userId = c.get("userId");
      const result = await runExtractionBatch(deps, { userId, idea, answers });
      return c.json({ result });
    })
    // For resuming after a tab close: the client has no batch id to poll,
    // so it asks "what's the most recent thing that happened for me" —
    // whatever state that batch is in (still running, completed, failed).
    .get("/batches/latest", async (c) => {
      const userId = c.get("userId");
      const batch = await deps.batchStore.latestForUser(userId);
      return c.json({ batch });
    })
    // Edit ops (task list check/uncheck/add, agent merge/split) submit
    // their edited task list here and get back a chart re-derived by the
    // REAL assembleOrgChart clustering (packages/agents/extraction) — not
    // a client-side reimplementation of tier/autonomy/hands-scope
    // resolution. No new LLM call, no cost change: same idea, template
    // selection, customization log, and call history as the original
    // batch, just a fresh task -> agent -> team derivation.
    .post("/batches/:id/reassemble", zValidator("json", reassembleSchema), async (c) => {
      const { tasks } = c.req.valid("json");
      const userId = c.get("userId");
      const id = c.req.param("id");

      const batch = await deps.batchStore.get(userId, id);
      if (!batch || !batch.orgChart) {
        return c.json({ error: "No completed batch with that id for this user" }, 404);
      }

      const chart = assembleOrgChart(
        batch.orgChart.meta.idea,
        batch.orgChart.meta.templateSelection,
        tasks,
        batch.orgChart.customization,
        batch.orgChart.meta.calls,
      );
      await deps.batchStore.updateOrgChart(userId, id, chart);
      return c.json({ chart });
    })
    // Renaming doesn't need re-clustering (it's a leaf field, not derived
    // from task metadata) — a direct patch to the persisted chart's
    // matching agent, name-never-without-title preserved since title is
    // untouched. NOT folded into /reassemble: re-running assembleOrgChart
    // would regenerate every agent's name from its deterministic name
    // bank, silently discarding this rename the moment any OTHER edit
    // (e.g. a merge elsewhere in the chart) resubmitted the task list.
    .post("/batches/:id/rename-agent", zValidator("json", renameAgentSchema), async (c) => {
      const { agentId, name } = c.req.valid("json");
      const userId = c.get("userId");
      const id = c.req.param("id");

      const batch = await deps.batchStore.get(userId, id);
      if (!batch || !batch.orgChart) {
        return c.json({ error: "No completed batch with that id for this user" }, 404);
      }

      const agent = batch.orgChart.agents.find((a) => a.id === agentId);
      if (!agent) {
        return c.json({ error: "No agent with that id on this chart" }, 404);
      }

      const chart = { ...batch.orgChart, agents: batch.orgChart.agents.map((a) => (a.id === agentId ? { ...a, name } : a)) };
      await deps.batchStore.updateOrgChart(userId, id, chart);
      return c.json({ chart });
    });
}
