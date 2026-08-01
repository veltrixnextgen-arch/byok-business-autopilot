import type { OrgChart } from "./types.js";

const AUTONOMY_SYMBOL = { locked: "🔒", earnable: "⏳", "eligible-early": "✅" } as const;

export function printTree(chart: OrgChart): string {
  const lines: string[] = [];
  const { meta } = chart;

  lines.push(`Org chart for: "${meta.idea}"`);
  const blend = meta.templateSelection.blendedWith ? ` + blend of ${meta.templateSelection.blendedWith}` : "";
  lines.push(`Template: ${meta.templateSelection.primary}${blend}`);
  lines.push(`Cost: $${meta.costUsd.toFixed(4)} total`);
  for (const call of meta.calls) {
    lines.push(`  - ${call.step}: $${call.costUsd.toFixed(4)} (${call.inputTokens} in / ${call.outputTokens} out, ${call.model})`);
  }
  lines.push(
    `Customization: +${chart.customization.added.length} added, -${chart.customization.removed.length} removed, ` +
      `${chart.customization.frequencyAdjustments.length} frequency change(s), ` +
      `${chart.customization.categoryCorrections.length} category correction(s)`,
  );
  lines.push("");

  for (const team of chart.teams) {
    lines.push(`${team.roleTitle}${team.isHuman ? " (human — the user)" : ""}`);
    const subAgents = team.subAgentIds.map((id) => chart.subAgents.find((s) => s.id === id)!);
    subAgents.forEach((sub, i) => {
      const isLast = i === subAgents.length - 1;
      const branch = isLast ? "└─" : "├─";
      const tools = sub.handsTools.length ? ` (${sub.handsTools.join(", ")})` : "";
      const taskWord = sub.taskIds.length === 1 ? "task" : "tasks";
      lines.push(
        `  ${branch} ${sub.label} [${sub.suggestedTier}, ${AUTONOMY_SYMBOL[sub.autonomyDefault]} ${sub.autonomyDefault}] ` +
          `— ${sub.taskIds.length} ${taskWord}${tools}`,
      );
    });
    lines.push("");
  }

  lines.push(`${chart.teams.length} teams, ${chart.subAgents.length} sub-agents, ${chart.tasks.length} tasks total.`);

  lines.push("");
  if (chart.onboardingBatch) {
    lines.push(`Simulated day (${chart.onboardingBatch.simulatedDay.length} cards):`);
    for (const card of chart.onboardingBatch.simulatedDay) {
      lines.push(`  - ${card.agentName} · ${card.roleTitle}: ${card.summary}`);
    }
    lines.push("");
    lines.push(`Charter draft: "${chart.onboardingBatch.charterDraft.sharpenedIdea}"`);
    lines.push(`  MVP: ${chart.onboardingBatch.charterDraft.mvpDefinition}`);
    lines.push(`  Month-one goals: ${chart.onboardingBatch.charterDraft.monthOneGoals.join(" · ")}`);
    lines.push(`  Budget: ${chart.onboardingBatch.charterDraft.budgetCeilingPlaceholder}`);
  } else {
    lines.push("Onboarding batch: skipped (see stderr log for why).");
  }

  return lines.join("\n");
}
