import assert from "node:assert/strict";
import { test } from "node:test";
import { MissingTenantIdError, TenantQueue, type QueueLike } from "./queue.js";
import type { TenantJobPayload } from "./types.js";

interface SendInvoicePayload extends TenantJobPayload {
  invoiceId: string;
}

function fakeQueue() {
  const added: Array<{ jobName: string; payload: SendInvoicePayload }> = [];
  const queue: QueueLike<SendInvoicePayload> = {
    async add(jobName, payload) {
      added.push({ jobName, payload });
      return { id: "job-1" };
    },
    async close() {},
  };
  return { queue, added };
}

test("adds a job whose payload carries a tenantId", async () => {
  const { queue, added } = fakeQueue();
  const tenantQueue = new TenantQueue<SendInvoicePayload>("invoices", queue);

  await tenantQueue.add("send", { tenantId: "tenant-1", invoiceId: "inv-1" });

  assert.equal(added.length, 1);
  assert.equal(added[0]?.payload.tenantId, "tenant-1");
});

test("refuses a payload missing tenantId, even if it slipped past the type system", async () => {
  const { queue, added } = fakeQueue();
  const tenantQueue = new TenantQueue<SendInvoicePayload>("invoices", queue);

  const untenantedPayload = { invoiceId: "inv-2" } as unknown as SendInvoicePayload;

  await assert.rejects(() => tenantQueue.add("send", untenantedPayload), MissingTenantIdError);
  assert.equal(added.length, 0);
});

test("refuses an empty-string tenantId", async () => {
  const { queue } = fakeQueue();
  const tenantQueue = new TenantQueue<SendInvoicePayload>("invoices", queue);

  await assert.rejects(
    () => tenantQueue.add("send", { tenantId: "", invoiceId: "inv-3" }),
    MissingTenantIdError,
  );
});
