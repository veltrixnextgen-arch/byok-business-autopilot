import { companyScopeKey, type DurableReservationStore } from "@byok/cost-gate";
import type { TenantCeilingStore } from "@byok/db";
import {
  buildSchedulePausedEmail,
  buildScheduleResumedEmail,
  buildSubscriptionRequiredEmail,
  type EmailSender,
  type PauseReason,
} from "@byok/notifications";
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

/**
 * One company per user (2026-09-03): fires when the scheduler pauses a
 * tenant specifically for lacking an active subscription — kept
 * separate from notifySchedulePaused above (never passed "ceiling-
 * exhausted" or any other PauseReason) so this can never send the
 * ceiling/spend-shaped email for a reason that has nothing to do with
 * spend. Same never-throws contract.
 */
export async function notifySubscriptionRequired(deps: ScheduleNotificationDeps, tenantId: string): Promise<void> {
  try {
    const emails = await deps.getOwnerEmails(tenantId);
    if (emails.length === 0) return;
    const { subject, text } = buildSubscriptionRequiredEmail({ dashboardUrl: deps.dashboardUrl });
    await sendToOwners(deps, emails, subject, text);
  } catch (err) {
    console.error("[notifications] Failed to prepare/send subscription-required notification:", err);
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
