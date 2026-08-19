import type { DurableBatchStore } from "@byok/cost-gate";
import type { CompanyCharterStore, SchedulerInstrumentationStore, SignupExtractionBatchStore, TenantScheduleStateStore } from "@byok/db";
import { syncTenantSchedule, type RepeatableQueueLike, type TenantTier } from "@byok/jobs";
import { Hono } from "hono";
import type { AppEnv } from "../context.js";
import { computeDesiredSchedule } from "../scheduler/computeDesiredSchedule.js";
import { notifyScheduleResumed, type ScheduleNotificationDeps } from "../scheduler/scheduleNotifications.js";
import { DEFAULT_MONTHLY_CEILING_USD } from "./ceiling.js";

export interface SchedulerRouteDeps {
  charters: Pick<CompanyCharterStore, "getActive">;
  batchStore: Pick<SignupExtractionBatchStore, "latestForTenant">;
  scheduleState: Pick<TenantScheduleStateStore, "get" | "resume">;
  instrumentation: Pick<SchedulerInstrumentationStore, "getDaily">;
  durableBatchStore: Pick<DurableBatchStore, "complete" | "get">;
  getTenantTier: (tenantId: string) => Promise<TenantTier>;
  queue: RepeatableQueueLike;
  jobName: string;
  /** Issue #140: /status surfaces enough for the dashboard banner to
   *  answer "what paused, why, what it costs to resume" without a second
   *  round-trip; /resume fires the "you're back" email closing the loop
   *  the pause email opened. */
  notifications: ScheduleNotificationDeps;
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
      const paused = state.pausedAt !== null;

      // Issue #140: the dashboard banner needs "what it costs to resume"
      // in the same response it already fetches, not a second round-trip
      // per screen it appears on. Only fetched when actually paused —
      // this is the hot path (a healthy tenant polling status) and it
      // should stay as cheap as it already was.
      let remainingTaskCount: number | null = null;
      let ceilingUsd: number | null = null;
      let spentUsd: number | null = null;
      if (paused) {
        const [batch, ceilingOverride, totals] = await Promise.all([
          state.pausedBatchId ? deps.durableBatchStore.get(tenantId, state.pausedBatchId).catch(() => null) : null,
          deps.notifications.ceilings.get(tenantId),
          deps.notifications.reservationTotals.totals(tenantId, "company", "company"),
        ]);
        remainingTaskCount = batch?.remainingTasks.length ?? null;
        ceilingUsd = ceilingOverride ?? DEFAULT_MONTHLY_CEILING_USD;
        spentUsd = totals.totalUsd;
      }

      return c.json({
        paused,
        pausedAt: state.pausedAt,
        pausedReason: state.pausedReason,
        remainingTaskCount,
        ceilingUsd,
        spentUsd,
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
      // Issue #140: closes the loop the pause email opened — never
      // throws, so a notification hiccup can't turn a successful resume
      // into a failed response.
      await notifyScheduleResumed(deps.notifications, tenantId);
      return c.json({ paused: false });
    });
}
