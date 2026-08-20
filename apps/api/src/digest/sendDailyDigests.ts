import { buildDigestEmail, type EmailSender } from "@byok/notifications";
import { buildDigestData, type DigestDeps } from "./buildDigestData.js";

export interface DailyDigestDeps {
  listTenantIds: () => Promise<string[]>;
  digest: DigestDeps;
  getOwnerEmails: (tenantId: string) => Promise<string[]>;
  emailSender: EmailSender;
  dashboardUrl: string;
}

export interface DailyDigestSummary {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Batched, not fanned out: ONE job execution loops every tenant, rather
 * than one BullMQ repeatable job per tenant the way scheduled-dispatch
 * works — a daily email is cheap to send but not free to *schedule* N
 * times over. No LLM call anywhere in this path: the digest is built
 * entirely from existing structured reads (cost_reservations,
 * approval_queue_items, the org chart), so there's no per-tenant COGS
 * line item to record here — see buildDigestData.ts's own doc comment.
 *
 * Never throws: one tenant's failure (a bad org chart read, a rejected
 * email send) must never abort the batch for every other tenant, the
 * same discipline scheduleNotifications.ts established for the pause/
 * resume emails, extended here to per-tenant granularity inside a loop.
 */
export async function sendDailyDigests(deps: DailyDigestDeps): Promise<DailyDigestSummary> {
  const summary: DailyDigestSummary = { sent: 0, skipped: 0, failed: 0 };
  let tenantIds: string[];
  try {
    tenantIds = await deps.listTenantIds();
  } catch (err) {
    console.error("Daily digest: could not list tenants, sending nothing:", err);
    return summary;
  }

  for (const tenantId of tenantIds) {
    try {
      const data = await buildDigestData(deps.digest, tenantId);
      if (!data) {
        summary.skipped++;
        continue;
      }
      const emails = await deps.getOwnerEmails(tenantId);
      if (emails.length === 0) {
        summary.skipped++;
        continue;
      }
      const { subject, text } = buildDigestEmail({ ...data, dashboardUrl: deps.dashboardUrl });
      await Promise.allSettled(emails.map((to) => deps.emailSender.send({ to, subject, text })));
      summary.sent++;
    } catch (err) {
      summary.failed++;
      console.error(`Daily digest failed for tenant ${tenantId}:`, err);
    }
  }

  return summary;
}
