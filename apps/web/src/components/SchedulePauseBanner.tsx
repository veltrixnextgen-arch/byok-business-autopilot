import { useEffect, useState } from "react";
import { getSchedulerStatus, resumeSchedule, type SchedulerStatus } from "../lib/schedulerClient";
import { Button, Card } from "./ui";

// Issue #140: a ceiling-triggered pause was previously invisible — no
// email, no dashboard signal, nothing. This banner is "minimum viable
// visibility": dropped onto every screen where schedules are visible
// (Dashboard, Agents, Spending), it answers what paused, why, what it
// costs to resume, and lets the user resume from right here. Renders
// nothing when the tenant isn't paused, or while that's still unknown —
// this must never flash on for a healthy tenant before the check resolves.
const REASON_TEXT: Record<string, string> = {
  "ceiling-exhausted": "your monthly spend ceiling was reached",
  "provider-billing-failure": "there was a billing issue with your AI provider",
};

export function SchedulePauseBanner() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSchedulerStatus()
      .then(setStatus)
      .catch(() => setStatus(null)); // fire-and-forget, same spirit as this screen's other background checks
  }, []);

  if (!status?.paused) return null;

  async function handleResume() {
    setResuming(true);
    setError(null);
    try {
      await resumeSchedule();
      setStatus(await getSchedulerStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resume — try again.");
    } finally {
      setResuming(false);
    }
  }

  const reason = status.pausedReason ? (REASON_TEXT[status.pausedReason] ?? status.pausedReason) : "of a spending or billing issue";
  const remaining =
    status.remainingTaskCount !== null ? `${status.remainingTaskCount} task${status.remainingTaskCount === 1 ? "" : "s"} waiting` : "Work waiting";
  const cost =
    status.spentUsd !== null && status.ceilingUsd !== null
      ? `Current spend: $${status.spentUsd.toFixed(2)} of your $${status.ceilingUsd.toFixed(2)} monthly ceiling.`
      : null;

  return (
    <Card className="mb-8 flex flex-col items-start justify-between gap-4 border-danger/30 bg-danger/10 last:mb-0 sm:flex-row sm:items-center">
      <div>
        <p className="font-display text-base font-semibold text-text">Your automation is paused</p>
        <p className="mt-1 text-sm text-text-secondary">
          Scheduled tasks stopped because {reason}. {remaining} to resume.
        </p>
        {cost && <p className="mt-1 text-sm text-text-secondary">{cost}</p>}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
      <Button variant="gradient" className="shrink-0" disabled={resuming} onClick={handleResume}>
        {resuming ? "Resuming…" : "Resume"}
      </Button>
    </Card>
  );
}
