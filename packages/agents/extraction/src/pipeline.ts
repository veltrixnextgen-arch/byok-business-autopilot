import { allTemplates } from "@byok/templates";
import type { TemplateTask } from "@byok/templates";
import { selectTemplate } from "./templateSelect.js";
import { runCustomizePass } from "./customize.js";
import { validateCategories } from "./categoryValidator.js";
import { assembleOrgChart, HandsScopeViolationError } from "./assemble.js";
import { generateOnboardingBatch } from "./onboardingBatch.js";
import type { ApiCallUsage, CustomizationLog, InterviewAnswers, OrgChart, Task } from "./types.js";
import { CostGuardError, DEFAULT_MAX_COST_USD } from "./costGuard.js";
import { deriveScheduleMetadata } from "./scheduleMetadata.js";

export interface ExtractOptions {
  apiKey: string;
  maxCostUsd?: number;
}

function templateTaskToTask(t: TemplateTask): Task {
  return { ...t, origin: "template" };
}

export async function extractOrgChart(idea: string, answers: InterviewAnswers, opts: ExtractOptions): Promise<OrgChart> {
  const maxCostUsd = opts.maxCostUsd ?? DEFAULT_MAX_COST_USD;

  // Step 1: template selection (which of the 5, or a blend of 2).
  const selection = selectTemplate(idea, answers);
  const primaryTemplate = allTemplates[selection.primary];

  // Union template tasks, de-duplicated by id, when blending two templates.
  const baseTasksById = new Map<string, TemplateTask>();
  for (const t of primaryTemplate.tasks) baseTasksById.set(t.id, t);
  if (selection.blendedWith) {
    for (const t of allTemplates[selection.blendedWith].tasks) {
      if (!baseTasksById.has(t.id)) baseTasksById.set(t.id, t);
    }
  }
  const baseTasks = [...baseTasksById.values()];

  // Step 2: CUSTOMIZE pass via Claude — add idea-specific tasks, remove
  // irrelevant template tasks, adjust frequencies. Never regenerate from
  // scratch (ADR-001 spirit applied to the template+customize contract).
  const customizeRun = await runCustomizePass(idea, answers, primaryTemplate, {
    apiKey: opts.apiKey,
    maxCostUsd,
  });
  const { result } = customizeRun;

  // Defensive: the tool schema marks these required, but the API does not
  // hard-validate a model's tool-call output against it — an empty array
  // can come back as an omitted field instead. Never assume presence.
  const removedSet = new Set(result.removeTaskIds ?? []);
  const freqById = new Map((result.frequencyAdjustments ?? []).map((a) => [a.taskId, a.frequency]));
  const frequencyAdjustmentsLog: CustomizationLog["frequencyAdjustments"] = [];

  const keptTasks: Task[] = baseTasks
    .filter((t) => !removedSet.has(t.id))
    .map((t) => {
      const newFreq = freqById.get(t.id);
      if (newFreq && newFreq !== t.frequency) {
        frequencyAdjustmentsLog.push({ taskId: t.id, from: t.frequency, to: newFreq });
        return { ...templateTaskToTask(t), frequency: newFreq };
      }
      return templateTaskToTask(t);
    });

  const addedTasks: Task[] = (result.addTasks ?? []).map((a, idx) => ({
    id: `customize.${primaryTemplate.id}.${idx + 1}.${a.agentType}`,
    text: a.text,
    agentType: a.agentType,
    agentLabel: a.agentLabel,
    teamHint: a.teamHint,
    frequency: a.frequency,
    stakes: a.stakes,
    tier: a.tier,
    autonomy: a.autonomy,
    handsTool: a.handsTool,
    handsScope: a.handsScope,
    requiresProfessionalVerification: a.requiresProfessionalVerification,
    origin: "customize-added",
    ...deriveScheduleMetadata(a.frequency, a.agentType),
  }));

  const calls: ApiCallUsage[] = [
    { step: "customize", model: customizeRun.model, inputTokens: customizeRun.inputTokens, outputTokens: customizeRun.outputTokens, costUsd: customizeRun.costUsd },
  ];

  // Step 2.5: category-tagging validation (change #2) — a single cheap
  // batched haiku-class call re-checks the categories the customize pass
  // just self-assigned to addedTasks, against the remaining run budget.
  // This is a quality pass, not core to producing a chart, so a budget
  // shortfall or transient failure here degrades gracefully (original
  // categories kept) instead of failing the whole extraction.
  let categoryCorrections: CustomizationLog["categoryCorrections"] = [];
  const preValidationTeamHints = new Map(addedTasks.map((t) => [t.id, t.teamHint]));
  const remainingBudget = maxCostUsd - customizeRun.costUsd;
  if (addedTasks.length > 0 && remainingBudget > 0) {
    try {
      const validateRun = await validateCategories(addedTasks, opts.apiKey, remainingBudget);
      calls.push(validateRun.usage);
      categoryCorrections = validateRun.corrections;

      const correctionByTaskId = new Map(validateRun.corrections.map((c) => [c.taskId, c.to]));
      for (const task of addedTasks) {
        const corrected = correctionByTaskId.get(task.id);
        if (corrected) task.teamHint = corrected;
      }
      for (const c of validateRun.corrections) {
        console.error(`[category-validate] ${c.taskId}: ${c.from} -> ${c.to} (${c.reason})`);
      }
    } catch (err) {
      if (err instanceof CostGuardError) {
        console.error(`[category-validate] skipped: ${err.message}`);
      } else {
        console.error(`[category-validate] skipped after error: ${(err as Error).message}`);
      }
    }
  }

  const finalTasks = [...keptTasks, ...addedTasks];

  const customization: CustomizationLog = {
    added: addedTasks.map((t) => t.id),
    removed: [...removedSet].filter((id) => baseTasksById.has(id)),
    frequencyAdjustments: frequencyAdjustmentsLog,
    categoryCorrections,
    notes: result.notes,
  };

  // Steps 3-4: clustering + bottom-up assembly into agents, teams, roles.
  // The Hands-scope-separation check inside assembleOrgChart is a hard
  // invariant (never let a client-facing and own-backoffice agent share
  // a credential identifier) — but a category *correction* from the
  // validation pass can occasionally recreate exactly that collision (e.g.
  // moving a task from "delivery" back to "cfo" while its handsTool string
  // still says "client-scoped"). Corrections are best-effort, not gospel:
  // if applying them breaks the hard invariant, discard the corrections and
  // fall back to the pre-validation (already scope-safe) categorization
  // rather than failing the whole run.
  let chart: OrgChart;
  try {
    chart = assembleOrgChart(idea, selection, finalTasks, customization, calls);
  } catch (err) {
    if (!(err instanceof HandsScopeViolationError) || categoryCorrections.length === 0) throw err;

    console.error(`[category-validate] reverting corrections after Hands-scope violation: ${err.message}`);
    for (const task of addedTasks) {
      const original = preValidationTeamHints.get(task.id);
      if (original) task.teamHint = original;
    }
    const revertedCustomization: CustomizationLog = { ...customization, categoryCorrections: [] };
    chart = assembleOrgChart(idea, selection, finalTasks, revertedCustomization, calls);
  }

  // Step 5: onboarding batch (simulated-day script + Charter draft), from
  // the same per-signup batch (master-plan-v2.md §4). Needs the FINAL chart,
  // so it runs after assembly.
  //
  // Issue #124: only a genuine, pre-flight BUDGET decision degrades
  // gracefully here (CostGuardError, or no budget left at all) — that's a
  // deliberate cost-safety tradeoff (ADR-003), not a malfunction, and an
  // otherwise-valid, fully-extracted org chart shouldn't be thrown away
  // over it. Everything else — a truncated tool call
  // (stop_reason=max_tokens), a malformed response, a network failure —
  // used to degrade the exact same way, which was the actual bug: this
  // output is load-bearing (charter.ts's POST /me/charter/draft seeds the
  // Charter draft from exactly this field), so a silently-null
  // onboardingBatch didn't mean "no bonus preview," it meant "this
  // tenant can never draft or accept a Charter, with no visible error."
  // Re-throwing here routes into runExtractionBatch.ts's existing
  // catch block, which already turns any extractOrgChart failure into a
  // real batch.status="failed" + a plain-language error the user sees and
  // can retry from — no new failure-surfacing mechanism needed, just not
  // swallowing the ones that don't belong here.
  const batchRemainingBudget = maxCostUsd - chart.meta.costUsd;
  if (batchRemainingBudget > 0) {
    try {
      const { batch, usage } = await generateOnboardingBatch(chart, idea, answers, opts.apiKey, batchRemainingBudget);
      chart.onboardingBatch = batch;
      chart.meta.calls.push(usage);
      chart.meta.costUsd = chart.meta.calls.reduce((sum, c) => sum + c.costUsd, 0);
    } catch (err) {
      if (err instanceof CostGuardError) {
        console.error(`[onboarding-batch] skipped: ${err.message}`);
      } else {
        throw err;
      }
    }
  } else {
    console.error(`[onboarding-batch] skipped: no budget remaining ($${batchRemainingBudget.toFixed(4)}).`);
  }

  return chart;
}
