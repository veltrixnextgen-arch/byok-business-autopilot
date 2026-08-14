import type { DurableBatchStore } from "@byok/cost-gate";
import type { CompanyCharterStore, SchedulerInstrumentationStore, SignupExtractionBatchStore, TenantScheduleStateStore } from "@byok/db";
import { syncTenantSchedule, type RepeatableQueueLike, type TenantTier } from "@byok/jobs";
import { Hono } from "hono";
import type { AppEnv } from "../context.js";
import { computeDesiredSchedule } from "../scheduler/computeDesiredSchedule.js";

export interface SchedulerRouteDeps {
  charters: Pick<CompanyCharterStore, "getActive">;
  batchStore: Pick<SignupExtractionBatchStore, "latestForTenant">;
  scheduleState: Pick<TenantScheduleStateStore, "get" | "resume">;
  instrumentation: Pick<SchedulerInstrumentationStore, "getDaily">;
  durableBatchStore: Pick<DurableBatchStore, "complete">;
  getTenantTier: (tenantId: string) => Promise<TenantTier>;
  queue: RepeatableQueueLike;
  jobName: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * R3 (docs/architecture/automation-runtime-plan.md §3(a)/§7/§8, ADR-025).
 * `POST /sync` is idempotent and safe to call any time the tenant's Charter
 * or org chart might have changed — it's also called automatically from
 * the Charter-accept handler (apps/api/src/routes/charter.ts), so a caller
 * only needs this route directly for a manual re-sync (e.g. after a tier
 * change moves the cadence floor).
 */
export function schedulerRoute(deps: SchedulerRouteDeps) {
  return new Hono<AppEnv>()
    .post("/sync", async (c) => {
      const tenantId = c.get("tenantId");
      const [charter, batch, tier] = await Promise.all([
        deps.charters.getActive(tenantId),
        deps.batchStore.latestForTenant(tenantId),
        deps.getTenantTier(tenantId),
      ]);
      if (!charter?.cascade || !batch?.orgChart) {
        return c.json({ error: "No active Charter with an installed cascade to schedule from." }, 409);
      }

      const { desired, clampNotes } = computeDesiredSchedule(tenantId, tier, batch.orgChart);
      const result = await syncTenantSchedule(deps.queue, deps.jobName, tenantId, desired);
      return c.json({ ...result, clampNotes });
    })
    .get("/status", async (c) => {
      const tenantId = c.get("tenantId");
      const [state, today] = await Promise.all([deps.scheduleState.get(tenantId), deps.instrumentation.getDaily(tenantId, todayIso())]);
      return c.json({
        paused: state.pausedAt !== null,
        pausedAt: state.pausedAt,
        pausedReason: state.pausedReason,
        today: today ?? {
          scheduledRunsExecuted: 0,
          eventTriggersReceived: 0,
          chainStepsCompleted: 0,
          ledgerRowsWritten: 0,
          workerSecondsConsumed: 0,
        },
      });
    })
    // Clears the pause flag only — the underlying BullMQ repeatable jobs
    // were never removed while paused (the worker no-ops them instead, so
    // resuming doesn't need a re-sync to pick back up where it left off).
    .post("/resume", async (c) => {
      const tenantId = c.get("tenantId");
      const state = await deps.scheduleState.get(tenantId);
      if (state.pausedBatchId) {
        await deps.durableBatchStore.complete(tenantId, state.pausedBatchId);
      }
      await deps.scheduleState.resume(tenantId);
      return c.json({ paused: false });
    });
}
