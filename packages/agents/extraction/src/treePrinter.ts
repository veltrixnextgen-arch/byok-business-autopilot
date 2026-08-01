import type { OrgChart } from "./types.js";

const AUTONOMY_SYMBOL = { locked: "🔒", earnable: "⏳", "eligible-early": "✅" } as const;

export function printTree(chart: OrgChart): string {
  const lines: string[] = [];
  const { meta } = chart;

  lines.push(`Org chart for: "${meta.idea}"`);
  const blend = meta.templateSelection.blendedWith ? ` + blend of ${meta.templateSelection.blendedWith}` : "";
  lines.push(`Template: ${meta.templateSelection.primary}${blend}`);
  lines.push(
    `Cost: $${meta.costUsd.toFixed(4)} (${meta.inputTokens} in / ${meta.outputTokens} out tokens, ${meta.model})`,
  );
  lines.push(
    `Customization: +${chart.customization.added.length} added, -${chart.customization.removed.length} removed, ` +
      `${chart.customization.frequencyAdjustments.length} frequency change(s)`,
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

  return lines.join("\n");
}
