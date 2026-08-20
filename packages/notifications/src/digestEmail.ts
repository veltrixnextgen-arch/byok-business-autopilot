export interface DigestAgentActivity {
  agentName: string;
  taskCount: number;
  spentUsd: number;
}

export interface DigestInput {
  date: string; // yyyy-mm-dd
  agentActivity: DigestAgentActivity[];
  pendingApprovalCount: number;
  spentUsd: number;
  ceilingUsd: number;
  dashboardUrl: string;
}

/** Plain text, same reasoning as scheduleAlerts.ts's own emails — this is
 *  a "here's what happened" report, not marketing content. Every figure
 *  here comes straight from DigestInput; this function invents nothing —
 *  an empty agentActivity array renders as "No agent activity today",
 *  never a fabricated placeholder. */
export function buildDigestEmail(input: DigestInput): { subject: string; text: string } {
  const lines = [`Your daily summary — ${input.date}`, ""];

  if (input.agentActivity.length === 0) {
    lines.push("No agent activity today.");
  } else {
    lines.push("What your agents did:");
    for (const agent of input.agentActivity) {
      lines.push(`- ${agent.agentName}: ${agent.taskCount} task${agent.taskCount === 1 ? "" : "s"}, $${agent.spentUsd.toFixed(2)}`);
    }
  }

  lines.push("");
  lines.push(
    input.pendingApprovalCount > 0
      ? `${input.pendingApprovalCount} item${input.pendingApprovalCount === 1 ? "" : "s"} waiting on your approval.`
      : "Nothing waiting on your approval.",
  );

  lines.push("");
  lines.push(`Spend so far: $${input.spentUsd.toFixed(2)} of your $${input.ceilingUsd.toFixed(2)} monthly ceiling.`);

  lines.push("");
  lines.push(`View details: ${input.dashboardUrl}/digest`);

  return { subject: `Your daily summary — ${input.date}`, text: lines.join("\n") };
}
