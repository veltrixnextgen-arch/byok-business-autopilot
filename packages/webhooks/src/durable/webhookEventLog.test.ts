import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryWebhookEventLog } from "./webhookEventLog.js";
import type { VerifiedWebhookEvent } from "../types.js";

function makeEvent(overrides: Partial<VerifiedWebhookEvent> = {}): VerifiedWebhookEvent {
  return {
    provider: "stripe",
    eventType: "invoice.payment_failed",
    payload: { id: "in_test" },
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("record then recentForTenant returns the recorded event", async () => {
  const log = new InMemoryWebhookEventLog();
  await log.record("tenant-1", makeEvent());

  const recent = await log.recentForTenant("tenant-1");
  assert.equal(recent.length, 1);
  assert.equal(recent[0].eventType, "invoice.payment_failed");
});

test("recentForTenant is newest-first", async () => {
  const log = new InMemoryWebhookEventLog();
  await log.record("tenant-1", makeEvent({ eventType: "first" }));
  await log.record("tenant-1", makeEvent({ eventType: "second" }));

  const recent = await log.recentForTenant("tenant-1");
  assert.deepEqual(recent.map((e) => e.eventType), ["second", "first"]);
});

test("recentForTenant respects the limit", async () => {
  const log = new InMemoryWebhookEventLog();
  for (let i = 0; i < 5; i++) await log.record("tenant-1", makeEvent({ eventType: `event-${i}` }));

  const recent = await log.recentForTenant("tenant-1", 2);
  assert.equal(recent.length, 2);
});

test("events are isolated per tenant", async () => {
  const log = new InMemoryWebhookEventLog();
  await log.record("tenant-a", makeEvent({ eventType: "for-a" }));
  await log.record("tenant-b", makeEvent({ eventType: "for-b" }));

  assert.deepEqual((await log.recentForTenant("tenant-a")).map((e) => e.eventType), ["for-a"]);
  assert.deepEqual((await log.recentForTenant("tenant-b")).map((e) => e.eventType), ["for-b"]);
});
