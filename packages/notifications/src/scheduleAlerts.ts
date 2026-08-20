export type PauseReason = "provider-billing-failure" | "ceiling-exhausted";

export interface SchedulePausedInput {
  reason: PauseReason;
  /** null when the paused batch's own record couldn't be read for some
   *  reason — the email still sends, just without a task count. */
  remainingTaskCount: number | null;
  ceilingUsd: number;
  spentUsd: number;
  dashboardUrl: string;
}

const REASON_TEXT: Record<PauseReason, string> = {
  "ceiling-exhausted": "your monthly spend ceiling was reached",
  "provider-billing-failure": "there was a billing issue with your AI provider",
};

/** Plain text, deliberately — this is a "wake up to a notification"
 *  alert, not marketing content; no HTML template to maintain for a
 *  first version. */
export function buildSchedulePausedEmail(input: SchedulePausedInput): { subject: string; text: string } {
  const remaining =
    input.remainingTaskCount !== null ? `${input.remainingTaskCount} task${input.remainingTaskCount === 1 ? "" : "s"}` : "Some work";
  return {
    subject: "Your automation has paused",
    text: [
      `Your scheduled tasks have paused because ${REASON_TEXT[input.reason]}.`,
      "",
      `${remaining} waiting to resume once you're ready.`,
      `Current spend: $${input.spentUsd.toFixed(2)} of your $${input.ceilingUsd.toFixed(2)} monthly ceiling.`,
      "",
      `Review and resume: ${input.dashboardUrl}`,
    ].join("\n"),
  };
}

export function buildScheduleResumedEmail(input: { dashboardUrl: string }): { subject: string; text: string } {
  return {
    subject: "Your automation has resumed",
    text: ["Your scheduled tasks are running again.", "", `View activity: ${input.dashboardUrl}`].join("\n"),
  };
}
