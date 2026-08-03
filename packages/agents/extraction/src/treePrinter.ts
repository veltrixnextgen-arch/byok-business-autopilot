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
    const agents = team.agentIds.map((id) => chart.agents.find((a) => a.id === id)!);
    agents.forEach((agent, i) => {
      const isLast = i === agents.length - 1;
      const branch = isLast ? "└─" : "├─";
      const tools = agent.hands.length ? ` (${agent.hands.join(", ")})` : "";
      const taskWord = agent.taskIds.length === 1 ? "task" : "tasks";
      const lock = agent.complianceLocked ? " 🔏" : "";
      lines.push(
        `  ${branch} ${agent.name} · ${agent.title} [${agent.tier}, ${AUTONOMY_SYMBOL[agent.autonomyDefault]} ${agent.autonomyDefault}]${lock} ` +
          `— ${agent.taskIds.length} ${taskWord}${tools}`,
      );
    });
    lines.push("");
  }

  lines.push(`${chart.teams.length} teams, ${chart.agents.length} agents, ${chart.tasks.length} tasks total.`);

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
