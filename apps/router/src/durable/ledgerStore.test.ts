import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryDurableTaskLedger } from "./ledgerStore.js";

test("records per-sub-agent status transitions, in order", async () => {
  const ledger = new InMemoryDurableTaskLedger();
  await ledger.append({ tenantId: "t1", taskId: "task-1", subAgentId: "invoicing", status: "pending" });
  await ledger.append({ tenantId: "t1", taskId: "task-1", subAgentId: "invoicing", status: "in_progress" });
  await ledger.append({ tenantId: "t1", taskId: "task-1", subAgentId: "invoicing", status: "completed" });

  const entries = await ledger.entriesFor("t1", "invoicing");
  assert.deepEqual(
    entries.map((e) => e.status),
    ["pending", "in_progress", "completed"],
  );
});

test("isolates entries by tenant and by sub-agent", async () => {
  const ledger = new InMemoryDurableTaskLedger();
  await ledger.append({ tenantId: "t1", taskId: "task-1", subAgentId: "invoicing", status: "pending" });
  await ledger.append({ tenantId: "t1", taskId: "task-2", subAgentId: "outreach", status: "pending" });
  await ledger.append({ tenantId: "t2", taskId: "task-3", subAgentId: "invoicing", status: "pending" });

  const t1Invoicing = await ledger.entriesFor("t1", "invoicing");
  assert.equal(t1Invoicing.length, 1);
  assert.equal(t1Invoicing[0]?.taskId, "task-1");
});
