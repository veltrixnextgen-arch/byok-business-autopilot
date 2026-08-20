import assert from "node:assert/strict";
import { test } from "node:test";
import type { EmailInput } from "@byok/notifications";
import { notifySchedulePaused, notifyScheduleResumed, type ScheduleNotificationDeps } from "./scheduleNotifications.js";

function fakeDeps(overrides: Partial<ScheduleNotificationDeps> = {}): ScheduleNotificationDeps & { sent: EmailInput[] } {
  const sent: EmailInput[] = [];
  return {
    getOwnerEmails: async () => ["owner@example.com"],
    emailSender: { async send(input) { sent.push(input); } },
    ceilings: { get: async () => 50 },
    reservationTotals: { totals: async () => ({ totalUsd: 51.2, ceilingUsd: 50 }) },
    dashboardUrl: "https://example.com/dashboard",
    sent,
    ...overrides,
  };
}

test("notifySchedulePaused sends to every owner email with the real reason, task count, and dollar figures", async () => {
  const deps = fakeDeps({ getOwnerEmails: async () => ["owner@example.com", "admin@example.com"] });
  await notifySchedulePaused(deps, "tenant-1", { reason: "ceiling-exhausted", remainingTaskCount: 3 });

  assert.equal(deps.sent.length, 2);
  assert.equal(deps.sent[0]!.to, "owner@example.com");
  assert.equal(deps.sent[1]!.to, "admin@example.com");
  assert.match(deps.sent[0]!.text, /3 tasks waiting/);
  assert.match(deps.sent[0]!.text, /\$51\.20 of your \$50\.00/);
});

test("notifySchedulePaused falls back to the platform default ceiling when the tenant has no override", async () => {
  const deps = fakeDeps({ ceilings: { get: async () => null } });
  await notifySchedulePaused(deps, "tenant-1", { reason: "ceiling-exhausted", remainingTaskCount: 1 });
  assert.match(deps.sent[0]!.text, /\$50\.00 monthly ceiling/); // DEFAULT_MONTHLY_CEILING_USD
});

test("notifySchedulePaused sends nothing (and does not throw) when the tenant has no owner/admin emails on file", async () => {
  const deps = fakeDeps({ getOwnerEmails: async () => [] });
  await notifySchedulePaused(deps, "tenant-1", { reason: "ceiling-exhausted", remainingTaskCount: 1 });
  assert.equal(deps.sent.length, 0);
});

// The whole contract this module exists to guarantee: a notification
// failure must never propagate and block/undo the pause it's reporting.
test("notifySchedulePaused never throws, even when every dependency rejects", async () => {
  const deps = fakeDeps({
    getOwnerEmails: async () => {
      throw new Error("db unavailable");
    },
  });
  await assert.doesNotReject(() => notifySchedulePaused(deps, "tenant-1", { reason: "ceiling-exhausted", remainingTaskCount: 1 }));
});

test("notifySchedulePaused never throws when the email send itself rejects", async () => {
  const deps = fakeDeps({
    emailSender: {
      async send() {
        throw new Error("Resend API returned 500");
      },
    },
  });
  await assert.doesNotReject(() => notifySchedulePaused(deps, "tenant-1", { reason: "ceiling-exhausted", remainingTaskCount: 1 }));
});

test("notifyScheduleResumed sends a short resume email to every owner", async () => {
  const deps = fakeDeps({ getOwnerEmails: async () => ["owner@example.com"] });
  await notifyScheduleResumed(deps, "tenant-1");
  assert.equal(deps.sent.length, 1);
  assert.equal(deps.sent[0]!.subject, "Your automation has resumed");
});

test("notifyScheduleResumed never throws when getOwnerEmails rejects", async () => {
  const deps = fakeDeps({
    getOwnerEmails: async () => {
      throw new Error("db unavailable");
    },
  });
  await assert.doesNotReject(() => notifyScheduleResumed(deps, "tenant-1"));
});
