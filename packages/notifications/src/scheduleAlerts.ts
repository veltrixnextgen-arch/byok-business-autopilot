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

// One company per user (2026-09-03): deliberately its OWN email, not a
// third PauseReason value on buildSchedulePausedEmail — that template's
// copy is inherently ceiling/spend-shaped ("N tasks waiting", "$X of
// your $Y ceiling"), which is actively misleading for "you have no
// subscription" (there's no ceiling to report, and nothing is "waiting
// to resume" in the batch sense). Reusing it here would have told a
// tenant they'd hit their spend ceiling when the real reason is an
// unpaid/cancelled subscription — exactly the class of silent-wrong-
// signal bug this feature exists to avoid.
export function buildSubscriptionRequiredEmail(input: { dashboardUrl: string }): { subject: string; text: string } {
  return {
    subject: "Your automation has paused — subscription needed",
    text: [
      "Your scheduled tasks have paused because this company has no active subscription.",
      "",
      "Resubscribe to resume scheduled work.",
      "",
      `Manage billing: ${input.dashboardUrl}`,
    ].join("\n"),
  };
}
