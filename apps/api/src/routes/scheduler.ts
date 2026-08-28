import { zValidator } from "@hono/zod-validator";
import type { DurableBatchStore } from "@byok/cost-gate";
import type { CompanyCharterStore, SchedulerInstrumentationStore, SignupExtractionBatchStore, TenantScheduleStateStore } from "@byok/db";
import type { Cadence, OrgChart } from "@byok/contracts";
import { syncTenantSchedule, type QueueLike, type RepeatableQueueLike } from "@byok/jobs";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { computeDesiredSchedule, type ScheduledDispatchPayload } from "../scheduler/computeDesiredSchedule.js";
import { notifyScheduleResumed, type ScheduleNotificationDeps } from "../scheduler/scheduleNotifications.js";
import { DEFAULT_MONTHLY_CEILING_USD } from "./ceiling.js";

export interface SchedulerRouteDeps {
  charters: Pick<CompanyCharterStore, "getActive">;
  // Issue #141: cadence editing needs the write side too, tenant-scoped
  // (updateOrgChart alone is user-scoped and touches zero rows once a
  // chart is claimed — see that method's own comment in packages/db).
  batchStore: Pick<SignupExtractionBatchStore, "latestForTenant" | "updateOrgChartForTenant">;
  scheduleState: Pick<TenantScheduleStateStore, "get" | "resume">;
  instrumentation: Pick<SchedulerInstrumentationStore, "getDaily">;
  durableBatchStore: Pick<DurableBatchStore, "complete" | "get">;
  // Issue #159: run-now needs .add() (a one-off job) alongside the
  // repeatable-schedule API /sync already uses — a real BullMQ Queue
  // satisfies both structurally (queue.ts's own comment), so this is
  // just the type catching up to what's already passed in at bootstrap
  // (server.ts's createRepeatableQueue returns a real Queue either way).
  queue: RepeatableQueueLike & QueueLike<ScheduledDispatchPayload>;
  jobName: string;
  /** Issue #140: /status surfaces enough for the dashboard banner to
   *  answer "what paused, why, what it costs to resume" without a second
   *  round-trip; /resume fires the "you're back" email closing the loop
   *  the pause email opened. */
  notifications: ScheduleNotificationDeps;
}

const runNowSchema = z.object({ taskId: z.string().min(1) });

const CADENCE_VALUES = ["15min", "hourly", "nightly", "daily", "weekly", "monthly"] as const satisfies readonly Cadence[];
const updateCadenceSchema = z.object({ cadence: z.enum(CADENCE_VALUES) });

// Issue #159: curbs a tight-loop "spam run-now" pattern, not the primary
// defense against ceiling bypass — CostGate's own per-reservation check
// (Router, same path a real cadence tick uses) is that, regardless of how
// a task was dispatched. In-memory and per-process is a deliberate,
// acceptable simplification: losing this on redeploy only ever makes the
// window briefly more permissive, never less safe. A multi-replica
// deployment would need this moved to Postgres/Redis instead — single
// replica today (ADR-022's own standing assumption).
const RUN_NOW_COOLDOWN_MS = 60_000;
const lastRunNowAt = new Map<string, number>();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * R3 (docs/architecture/automation-runtime-plan.md §3(a)/§7/§8, ADR-025).
 * `POST /sync` is idempotent and safe to call any time the tenant's Charter
 * or org chart might have changed — it's also called automatically from
 * the Charter-accept handler (apps/api/src/routes/charter.ts), so a caller
 * only needs this route directly for a manual re-sync (e.g. after an org
 * chart edit changes what's schedulable).
 */
export function schedulerRoute(deps: SchedulerRouteDeps) {
  return new Hono<AppEnv>()
    .post("/sync", async (c) => {
      const tenantId = c.get("tenantId");
      const [charter, batch] = await Promise.all([deps.charters.getActive(tenantId), deps.batchStore.latestForTenant(tenantId)]);
      if (!charter?.cascade || !batch?.orgChart) {
        return c.json({ error: "No active Charter with an installed cascade to schedule from." }, 409);
      }

      const { desired, clampNotes } = computeDesiredSchedule(tenantId, batch.orgChart);
      const result = await syncTenantSchedule(deps.queue, deps.jobName, tenantId, desired);
      return c.json({ ...result, clampNotes });
    })
    // Issue #159: the only prior way to prove a real dispatch worked was a
    // one-off script run by hand against production Postgres/Redis
    // credentials (packages/jobs/scripts/manual-trigger-scheduled-
    // dispatch.mjs, kept as an ops-only diagnostic, not a substitute for
    // this). Same selection/dispatch shape as that script and as a real
    // cadence tick: one specific cadence-triggered task from the tenant's
    // own claimed org chart, enqueued via queue.add (never
    // upsertJobScheduler — this must not create or touch a recurring
    // schedule), refused outright while paused. Runs through the exact
    // same "scheduled-dispatch" queue/worker/CostGate path a real cadence
    // tick uses — nothing here is mocked or shortcut.
    .post("/run-now", zValidator("json", runNowSchema), async (c) => {
      const tenantId = c.get("tenantId");
      const { taskId } = c.req.valid("json");

      const state = await deps.scheduleState.get(tenantId);
      if (state.pausedAt !== null) {
        return c.json({ error: "Automation is paused — resume it before running a task manually." }, 409);
      }

      const cooldownKey = `${tenantId}:${taskId}`;
      const lastRun = lastRunNowAt.get(cooldownKey);
      if (lastRun !== undefined) {
        const elapsedMs = Date.now() - lastRun;
        if (elapsedMs < RUN_NOW_COOLDOWN_MS) {
          const retryAfterSeconds = Math.ceil((RUN_NOW_COOLDOWN_MS - elapsedMs) / 1000);
          return c.json({ error: `This task was just run — try again in ${retryAfterSeconds}s.` }, 429);
        }
      }

      const batch = await deps.batchStore.latestForTenant(tenantId);
      if (!batch?.orgChart) {
        return c.json({ error: "No claimed org chart to run a task from." }, 409);
      }

      const task = batch.orgChart.tasks.find((t) => t.id === taskId);
      if (!task || task.triggerType !== "cadence") {
        return c.json({ error: "No cadence-triggered task with that id." }, 404);
      }
      const agent = batch.orgChart.agents.find((a) => a.taskIds.includes(taskId));
      if (!agent) {
        return c.json({ error: "That task has no owning agent to dispatch as." }, 409);
      }

      lastRunNowAt.set(cooldownKey, Date.now());
      const payload: ScheduledDispatchPayload = { tenantId, agentId: agent.id, taskId };
      await deps.queue.add(deps.jobName, payload);

      return c.json({ enqueued: true, taskId, agentId: agent.id });
    })
    // Issue #141: the only prior way to change a task's cadence was a raw
    // SQL edit against signup_extraction_batches.org_chart — no product
    // surface existed at all. Stores the tenant's own DECLARED cadence
    // (not pre-clamped) — computeDesiredSchedule (the same mechanism
    // /sync uses) applies the floor clamp fresh at sync time regardless.
    // UI is a separate, larger question (agents/tasks screen) — API-only
    // here, same scoping call issue #141 itself makes.
    .patch("/tasks/:taskId/cadence", zValidator("json", updateCadenceSchema), async (c) => {
      const tenantId = c.get("tenantId");
      const taskId = c.req.param("taskId");
      const { cadence } = c.req.valid("json");

      const batch = await deps.batchStore.latestForTenant(tenantId);
      if (!batch?.orgChart) {
        return c.json({ error: "No claimed org chart to edit." }, 409);
      }

      const taskIndex = batch.orgChart.tasks.findIndex((t) => t.id === taskId);
      if (taskIndex === -1) {
        return c.json({ error: "No task with that id." }, 404);
      }
      if (batch.orgChart.tasks[taskIndex].triggerType !== "cadence") {
        return c.json({ error: "This task isn't cadence-triggered — there's no cadence to change." }, 409);
      }

      const updatedChart: OrgChart = {
        ...batch.orgChart,
        tasks: batch.orgChart.tasks.map((t, i) => (i === taskIndex ? { ...t, cadence } : t)),
      };
      await deps.batchStore.updateOrgChartForTenant(tenantId, batch.id, updatedChart);

      const { desired, clampNotes } = computeDesiredSchedule(tenantId, updatedChart);
      const result = await syncTenantSchedule(deps.queue, deps.jobName, tenantId, desired);

      return c.json({ cadence, ...result, clampNotes });
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
