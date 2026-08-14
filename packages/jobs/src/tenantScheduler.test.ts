import assert from "node:assert/strict";
import { test } from "node:test";
import { syncTenantSchedule, type JobSchedulerDescriptor, type RepeatableQueueLike } from "./tenantScheduler.js";

function fakeQueue(initial: Array<{ id: string; every?: number; pattern?: string }> = []): RepeatableQueueLike & {
  jobs: Map<string, JobSchedulerDescriptor>;
  upsertCalls: string[];
  removeCalls: string[];
} {
  const jobs = new Map<string, JobSchedulerDescriptor>();
  for (const j of initial) jobs.set(j.id, { id: j.id, every: j.every, pattern: j.pattern });
  const upsertCalls: string[] = [];
  const removeCalls: string[] = [];
  return {
    jobs,
    upsertCalls,
    removeCalls,
    async upsertJobScheduler(jobSchedulerId, repeatOpts) {
      const repeat = repeatOpts as { every?: number; pattern?: string };
      jobs.set(jobSchedulerId, { id: jobSchedulerId, every: repeat.every, pattern: repeat.pattern });
      upsertCalls.push(jobSchedulerId);
      return undefined;
    },
    async getJobSchedulers() {
      return [...jobs.values()];
    },
    async removeJobScheduler(jobSchedulerId) {
      if (!jobs.has(jobSchedulerId)) return false;
      jobs.delete(jobSchedulerId);
      removeCalls.push(jobSchedulerId);
      return true;
    },
  };
}

test("upserts a job scheduler for every desired task that has none yet", async () => {
  const queue = fakeQueue();
  const result = await syncTenantSchedule(queue, "scheduled-dispatch", "tenant-1", [
    { jobSchedulerId: "tenant-1:agent-a:task-1", cadence: "daily", payload: {} },
    { jobSchedulerId: "tenant-1:agent-b:task-2", cadence: "hourly", payload: {} },
  ]);

  assert.deepEqual(result.added.sort(), ["tenant-1:agent-a:task-1", "tenant-1:agent-b:task-2"]);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.unchanged, []);
  assert.equal(queue.jobs.size, 2);
});

test("leaves an already-scheduled task with an unchanged cadence alone — no upsert, no remove", async () => {
  const queue = fakeQueue([{ id: "tenant-1:agent-a:task-1", every: 24 * 60 * 60 * 1000 }]);
  const result = await syncTenantSchedule(queue, "scheduled-dispatch", "tenant-1", [
    { jobSchedulerId: "tenant-1:agent-a:task-1", cadence: "daily", payload: {} },
  ]);

  assert.deepEqual(result.unchanged, ["tenant-1:agent-a:task-1"]);
  assert.deepEqual(result.added, []);
  assert.deepEqual(queue.upsertCalls, []);
  assert.deepEqual(queue.removeCalls, []);
});

test("removes a job scheduler whose task is no longer in the desired schedule", async () => {
  const queue = fakeQueue([{ id: "tenant-1:agent-a:task-1", every: 24 * 60 * 60 * 1000 }]);
  const result = await syncTenantSchedule(queue, "scheduled-dispatch", "tenant-1", []);

  assert.deepEqual(result.removed, ["tenant-1:agent-a:task-1"]);
  assert.equal(queue.jobs.size, 0);
});

test("a cadence CHANGE for an already-scheduled task upserts fresh with the new interval, not left unchanged", async () => {
  const queue = fakeQueue([{ id: "tenant-1:agent-a:task-1", every: 24 * 60 * 60 * 1000 }]); // was daily
  const result = await syncTenantSchedule(queue, "scheduled-dispatch", "tenant-1", [
    { jobSchedulerId: "tenant-1:agent-a:task-1", cadence: "hourly", payload: {} }, // now hourly
  ]);

  assert.deepEqual(result.unchanged, []);
  assert.deepEqual(result.added, ["tenant-1:agent-a:task-1"]);
  const job = queue.jobs.get("tenant-1:agent-a:task-1");
  assert.equal(job?.every, 60 * 60 * 1000);
});

test("never touches another tenant's job schedulers, even sharing the same queue", async () => {
  const queue = fakeQueue([
    { id: "tenant-1:agent-a:task-1", every: 24 * 60 * 60 * 1000 },
    { id: "tenant-2:agent-x:task-9", every: 60 * 60 * 1000 },
  ]);
  const result = await syncTenantSchedule(queue, "scheduled-dispatch", "tenant-1", []);

  assert.deepEqual(result.removed, ["tenant-1:agent-a:task-1"]);
  assert.equal(queue.jobs.has("tenant-2:agent-x:task-9"), true);
});

test("nightly/monthly cadences (cron pattern, not every) are compared and synced correctly too", async () => {
  const queue = fakeQueue([{ id: "tenant-1:agent-a:task-1", pattern: "0 2 * * *" }]);
  const unchangedResult = await syncTenantSchedule(queue, "scheduled-dispatch", "tenant-1", [
    { jobSchedulerId: "tenant-1:agent-a:task-1", cadence: "nightly", payload: {} },
  ]);
  assert.deepEqual(unchangedResult.unchanged, ["tenant-1:agent-a:task-1"]);

  const changedResult = await syncTenantSchedule(queue, "scheduled-dispatch", "tenant-1", [
    { jobSchedulerId: "tenant-1:agent-a:task-1", cadence: "monthly", payload: {} },
  ]);
  assert.deepEqual(changedResult.added, ["tenant-1:agent-a:task-1"]);
  assert.equal(queue.jobs.get("tenant-1:agent-a:task-1")?.pattern, "0 9 1 * *");
});
