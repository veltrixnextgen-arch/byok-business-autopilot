import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryDurableAuditLog } from "./durableAuditLog.js";

test("appends and reads back events for a tenant, newest first", async () => {
  const log = new InMemoryDurableAuditLog();
  await log.append({ tenantId: "t1", source: "cost-gate", kind: "PROCEED", refId: "task-1" });
  await log.append({ tenantId: "t1", source: "approval-queue", kind: "queued", refId: "task-1" });

  const events = await log.recentForTenant("t1");
  assert.equal(events.length, 2);
  assert.equal(events[0]?.kind, "queued");
  assert.equal(events[1]?.kind, "PROCEED");
});

test("isolates events by tenant", async () => {
  const log = new InMemoryDurableAuditLog();
  await log.append({ tenantId: "t1", source: "cost-gate", kind: "PROCEED" });
  await log.append({ tenantId: "t2", source: "cost-gate", kind: "SKIP" });

  const t1Events = await log.recentForTenant("t1");
  assert.equal(t1Events.length, 1);
  assert.equal(t1Events[0]?.kind, "PROCEED");
});

test("respects the limit parameter", async () => {
  const log = new InMemoryDurableAuditLog();
  for (let i = 0; i < 5; i++) {
    await log.append({ tenantId: "t1", source: "cost-gate", kind: `event-${i}` });
  }
  const events = await log.recentForTenant("t1", 2);
  assert.equal(events.length, 2);
});
