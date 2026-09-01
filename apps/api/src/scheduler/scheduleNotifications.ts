import { companyScopeKey, type DurableReservationStore } from "@byok/cost-gate";
import type { TenantCeilingStore } from "@byok/db";
import { buildSchedulePausedEmail, buildScheduleResumedEmail, type EmailSender, type PauseReason } from "@byok/notifications";
import { DEFAULT_MONTHLY_CEILING_USD } from "../routes/ceiling.js";

export interface ScheduleNotificationDeps {
  getOwnerEmails: (tenantId: string) => Promise<string[]>;
  emailSender: EmailSender;
  ceilings: Pick<TenantCeilingStore, "get">;
  reservationTotals: Pick<DurableReservationStore, "totals">;
  dashboardUrl: string;
}

async function sendToOwners(deps: ScheduleNotificationDeps, emails: string[], subject: string, text: string): Promise<void> {
  const results = await Promise.allSettled(emails.map((to) => deps.emailSender.send({ to, subject, text })));
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[notifications] Failed to send schedule notification:", result.reason);
    }
  }
}

/**
 * Fires when a tenant's schedule pauses (issue #140). Never throws —
 * every failure mode here (no owner emails on file, a DB read failing, a
 * send rejecting) is caught and logged, not propagated, because a
 * notification failing must never be allowed to undo or block the pause
 * it's reporting on.
 */
export async function notifySchedulePaused(
  deps: ScheduleNotificationDeps,
  tenantId: string,
  input: { reason: PauseReason; remainingTaskCount: number | null },
): Promise<void> {
  try {
    const [emails, ceilingOverride, totals] = await Promise.all([
      deps.getOwnerEmails(tenantId),
      deps.ceilings.get(tenantId),
      deps.reservationTotals.totals(tenantId, "company", companyScopeKey()),
    ]);
    if (emails.length === 0) return;

    const { subject, text } = buildSchedulePausedEmail({
      reason: input.reason,
      remainingTaskCount: input.remainingTaskCount,
      ceilingUsd: ceilingOverride ?? DEFAULT_MONTHLY_CEILING_USD,
      spentUsd: totals.totalUsd,
      dashboardUrl: deps.dashboardUrl,
    });
    await sendToOwners(deps, emails, subject, text);
  } catch (err) {
    console.error("[notifications] Failed to prepare/send schedule-paused notification:", err);
  }
}

/** Same never-throws contract as notifySchedulePaused. */
export async function notifyScheduleResumed(deps: ScheduleNotificationDeps, tenantId: string): Promise<void> {
  try {
    const emails = await deps.getOwnerEmails(tenantId);
    if (emails.length === 0) return;
    const { subject, text } = buildScheduleResumedEmail({ dashboardUrl: deps.dashboardUrl });
    await sendToOwners(deps, emails, subject, text);
  } catch (err) {
    console.error("[notifications] Failed to prepare/send schedule-resumed notification:", err);
  }
}
