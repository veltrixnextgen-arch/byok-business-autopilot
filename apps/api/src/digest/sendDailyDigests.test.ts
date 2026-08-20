import assert from "node:assert/strict";
import { test } from "node:test";
import type { EmailInput } from "@byok/notifications";
import { sendDailyDigests, type DailyDigestDeps } from "./sendDailyDigests.js";

function fakeDeps(overrides: Partial<DailyDigestDeps> = {}): DailyDigestDeps & { sent: EmailInput[] } {
  const sent: EmailInput[] = [];
  return {
    listTenantIds: async () => ["tenant-1"],
    digest: {
      charters: { getActive: async () => ({ cascade: {} }) as never },
      batchStore: { latestForTenant: async () => ({ orgChart: { agents: [] } }) as never },
      costActivity: { activityByTaskType: async () => [] },
      approvalQueue: { pendingActions: async () => [], pendingRecommendationItems: async () => [] },
      ceilings: { get: async () => 50 },
      reservationTotals: { totals: async () => ({ totalUsd: 1, ceilingUsd: 50 }) },
    },
    getOwnerEmails: async () => ["owner@example.com"],
    emailSender: { async send(input) { sent.push(input); } },
    dashboardUrl: "https://example.com",
    sent,
    ...overrides,
  };
}

test("sends one email per tenant with owner emails and an active charter", async () => {
  const deps = fakeDeps({ listTenantIds: async () => ["tenant-1", "tenant-2"] });
  const summary = await sendDailyDigests(deps);
  assert.equal(summary.sent, 2);
  assert.equal(deps.sent.length, 2);
});

test("skips (not a failure) a tenant with no active Charter+org chart", async () => {
  const deps = fakeDeps({
    digest: {
      ...fakeDeps().digest,
      charters: { getActive: async () => null },
    },
  });
  const summary = await sendDailyDigests(deps);
  assert.deepEqual(summary, { sent: 0, skipped: 1, failed: 0 });
  assert.equal(deps.sent.length, 0);
});

test("skips (not a failure) a tenant with no owner/admin emails on file", async () => {
  const deps = fakeDeps({ getOwnerEmails: async () => [] });
  const summary = await sendDailyDigests(deps);
  assert.deepEqual(summary, { sent: 0, skipped: 1, failed: 0 });
});

test("one tenant's failure never aborts the batch for the rest", async () => {
  let calls = 0;
  const deps = fakeDeps({
    listTenantIds: async () => ["tenant-bad", "tenant-good"],
    digest: {
      ...fakeDeps().digest,
      charters: {
        getActive: async () => {
          calls++;
          if (calls === 1) throw new Error("db blew up for tenant-bad");
          return { cascade: {} } as never;
        },
      },
    },
  });
  const summary = await sendDailyDigests(deps);
  assert.deepEqual(summary, { sent: 1, skipped: 0, failed: 1 });
});

test("never throws even when listing tenants itself fails", async () => {
  const deps = fakeDeps({
    listTenantIds: async () => {
      throw new Error("pool exhausted");
    },
  });
  await assert.doesNotReject(() => sendDailyDigests(deps));
  const summary = await sendDailyDigests(deps);
  assert.deepEqual(summary, { sent: 0, skipped: 0, failed: 0 });
});

test("never throws even when an individual email send rejects", async () => {
  const deps = fakeDeps({
    emailSender: {
      async send() {
        throw new Error("Resend API down");
      },
    },
  });
  await assert.doesNotReject(() => sendDailyDigests(deps));
});
