import { allTemplates } from "@byok/templates";
import type { TemplateTask } from "@byok/templates";
import { selectTemplate } from "./templateSelect.js";
import { runCustomizePass } from "./customize.js";
import { assembleOrgChart } from "./assemble.js";
import type { CustomizationLog, InterviewAnswers, OrgChart, OrgChartTask } from "./types.js";
import { DEFAULT_MAX_COST_USD } from "./costGuard.js";

export interface ExtractOptions {
  apiKey: string;
  maxCostUsd?: number;
}

function templateTaskToOrgChartTask(t: TemplateTask): OrgChartTask {
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

  const removedSet = new Set(result.removeTaskIds);
  const freqById = new Map(result.frequencyAdjustments.map((a) => [a.taskId, a.frequency]));
  const frequencyAdjustmentsLog: CustomizationLog["frequencyAdjustments"] = [];

  const keptTasks: OrgChartTask[] = baseTasks
    .filter((t) => !removedSet.has(t.id))
    .map((t) => {
      const newFreq = freqById.get(t.id);
      if (newFreq && newFreq !== t.frequency) {
        frequencyAdjustmentsLog.push({ taskId: t.id, from: t.frequency, to: newFreq });
        return { ...templateTaskToOrgChartTask(t), frequency: newFreq };
      }
      return templateTaskToOrgChartTask(t);
    });

  const addedTasks: OrgChartTask[] = result.addTasks.map((a, idx) => ({
    id: `customize.${primaryTemplate.id}.${idx + 1}.${a.subAgentType}`,
    text: a.text,
    subAgentType: a.subAgentType,
    subAgentLabel: a.subAgentLabel,
    teamHint: a.teamHint,
    frequency: a.frequency,
    stakes: a.stakes,
    tier: a.tier,
    autonomy: a.autonomy,
    handsTool: a.handsTool,
    origin: "customize-added",
  }));

  const finalTasks = [...keptTasks, ...addedTasks];

  const customization: CustomizationLog = {
    added: addedTasks.map((t) => t.id),
    removed: [...removedSet].filter((id) => baseTasksById.has(id)),
    frequencyAdjustments: frequencyAdjustmentsLog,
    notes: result.notes,
  };

  // Steps 3-4: clustering + bottom-up assembly into sub-agents, teams, roles.
  return assembleOrgChart(idea, selection, finalTasks, customization, {
    model: customizeRun.model,
    inputTokens: customizeRun.inputTokens,
    outputTokens: customizeRun.outputTokens,
    costUsd: customizeRun.costUsd,
  });
}
