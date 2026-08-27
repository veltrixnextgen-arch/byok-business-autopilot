import type { PromptTier, Router, RouterTask, RouterTaskInput } from "@byok/router";
import type { DurableBatchStore, TierModelMapsByProvider } from "@byok/cost-gate";
import { selectModel } from "@byok/cost-gate";
import type { CompanyCharterStore, SchedulerInstrumentationStore, SignupExtractionBatchStore, TenantScheduleStateStore } from "@byok/db";
import type { Vault } from "@byok/vault";
import type { ScheduledDispatchPayload } from "./computeDesiredSchedule.js";
import { notifySchedulePaused, type ScheduleNotificationDeps } from "./scheduleNotifications.js";

export interface ScheduledDispatchDeps {
  router: Pick<Router, "submitTask">;
  charters: Pick<CompanyCharterStore, "getActive">;
  batchStore: Pick<SignupExtractionBatchStore, "latestForTenant">;
  scheduleState: Pick<TenantScheduleStateStore, "get" | "pause">;
  instrumentation: Pick<SchedulerInstrumentationStore, "recordScheduledRun">;
  durableBatchStore: Pick<DurableBatchStore, "pause">;
  /** Multi-provider AI (Phase 2 item 5, ADR-047/048): a scheduled dispatch
   *  picks its model BEFORE the task ever reaches CostGate, so it needs
   *  the SAME provider awareness CostGate's own downgrade path already
   *  has (ADR-047) — a role connected to OpenAI or Google must get an
   *  OpenAI/Google model here, not silently fall back to whatever the
   *  Anthropic map happens to contain. */
  tierModelMaps: TierModelMapsByProvider;
  /** Only used to look up which provider this role's Brain key actually
   *  belongs to (getBrainKeyStatus — a metadata read, never decrypts).
   *  Vault is the only source of truth for this; nothing about scheduled
   *  dispatch tracks provider choice on its own. */
  vault: Pick<Vault, "getBrainKeyStatus">;
  /** Issue #140: a schedule pausing must be visible, not silently
   *  discovered later (or never). notifySchedulePaused itself never
   *  throws, so wiring it in here can't turn a notification hiccup into a
   *  dispatch failure. */
  notifications: ScheduleNotificationDeps;
}

/** Router.submitTask's own ledger.append call count for each terminal
 *  shape (router.ts, R2): pending is always appended; in_progress only if
 *  the task got past the cost gate; then exactly one terminal append.
 *  QUEUE/SKIP never reach in_progress (2 total); every other path does (3
 *  total). Mirrors router.ts's actual code exactly — not a guess. */
function ledgerRowsFor(status: RouterTask["status"]): number {
  return status === "queued" || status === "skipped" ? 2 : 3;
}

/** The ONLY thing that produces a "queued"/"skipped" RouterTask status is
 *  the cost gate's verdict (router.ts's submitTask — QUEUE/SKIP are
 *  returned before the executor is ever reached, and nothing else in that
 *  path sets these statuses). Safe to treat every occurrence as a ceiling/
 *  budget signal without inspecting the ledger note text. */
function isCeilingExhaustion(task: RouterTask): boolean {
  return task.status === "queued" || task.status === "skipped";
}

export class UnschedulableDispatchError extends Error {}

/**
 * Processes one scheduled-dispatch job firing (packages/jobs's
 * tenantScheduler.ts registers these as BullMQ repeatable jobs). All the
 * actual trust-core enforcement — T10, the cost gate, the approval queue —
 * already lives in `Router.submitTask` (R2); this function's only real job
 * is composing the right input for it and handling what R3 adds on top:
 * pause-on-exhaustion and the §7 instrumentation meter.
 */
export function createScheduledDispatchProcessor(deps: ScheduledDispatchDeps) {
  return async function processScheduledDispatch(payload: ScheduledDispatchPayload): Promise<void> {
    const scheduleState = await deps.scheduleState.get(payload.tenantId);
    if (scheduleState.pausedAt) return; // paused for this tenant — cheap no-op, will fire again next cadence tick

    const [charter, batch] = await Promise.all([
      deps.charters.getActive(payload.tenantId),
      deps.batchStore.latestForTenant(payload.tenantId),
    ]);
    if (!charter?.cascade || !batch?.orgChart) {
      throw new UnschedulableDispatchError(
        `Tenant "${payload.tenantId}" has no active Charter+cascade or claimed org chart — the schedule sync that ` +
          `created this job should have been torn down. Not retrying with the same missing state.`,
      );
    }

    const chart = batch.orgChart;
    const agent = chart.agents.find((a) => a.id === payload.agentId);
    const task = chart.tasks.find((t) => t.id === payload.taskId);
    if (!agent || !task) {
      throw new UnschedulableDispatchError(
        `Tenant "${payload.tenantId}": agent "${payload.agentId}" or task "${payload.taskId}" no longer exists in ` +
          `the claimed org chart. Not retrying against stale ids.`,
      );
    }

    const promptTier: PromptTier = agent.teamId === "founder" ? "ceo" : "sub-agent";
    const systemPrompt =
      promptTier === "ceo" ? charter.cascade.ceo.text : charter.cascade.subAgents.find((p) => p.agentId === agent.id)?.text;

    // Same (tenantId, roleId) pair OpenMultiAgentExecutor itself later
    // decrypts with (task.tenantId + task.teamId, ADR-048) — a metadata
    // read only, never touches key material. No key connected yet reads
    // as "anthropic" (the historical default, matching this map's own
    // fallback below), not an error: the dispatch still needs SOME model
    // string to submit, and the real failure (no Brain key at all)
    // surfaces later, inside the executor, exactly as it always has.
    const brainKeyStatus = await deps.vault.getBrainKeyStatus(payload.tenantId, agent.teamId);
    const provider = brainKeyStatus?.type === "brain" ? brainKeyStatus.provider : "anthropic";
    const modelMap = deps.tierModelMaps[provider] ?? deps.tierModelMaps.anthropic;

    const input: RouterTaskInput = {
      subAgentId: agent.id,
      teamId: agent.teamId,
      title: task.text,
      payload: task.text,
      dedupKey: `${payload.taskId}:${new Date().toISOString()}`,
      model: selectModel(agent.tier, modelMap),
      tenantId: payload.tenantId,
      agentName: agent.name,
      systemPrompt,
      promptTier,
      batchable: task.batchable,
    };

    const start = Date.now();
    const result = await deps.router.submitTask(input);
    const workerSeconds = (Date.now() - start) / 1000;

    await deps.instrumentation.recordScheduledRun(payload.tenantId, {
      workerSeconds,
      ledgerRowsWritten: ledgerRowsFor(result.status),
    });

    if (isCeilingExhaustion(result)) {
      const paused = await deps.durableBatchStore.pause({
        tenantId: payload.tenantId,
        reason: "ceiling-exhausted",
        completedTaskIds: [],
        remainingTasks: [{ id: task.id, agentId: agent.id, jobKey: `${payload.tenantId}:${agent.id}:${task.id}` }],
        context: { triggeredBy: "scheduled-dispatch", agentId: agent.id, taskId: task.id },
      });
      await deps.scheduleState.pause(payload.tenantId, "ceiling-exhausted", paused.id);
      await notifySchedulePaused(deps.notifications, payload.tenantId, {
        reason: "ceiling-exhausted",
        remainingTaskCount: paused.remainingTasks.length,
      });
    }
  };
}
