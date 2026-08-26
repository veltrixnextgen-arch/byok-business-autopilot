import { randomUUID } from "node:crypto";
import type { CostGate, Reservation } from "@byok/cost-gate";
import { ApprovalQueue } from "@byok/approval-queue";
import { isProductionEnvironment } from "@byok/vault";
import type { AgentExecutor } from "./executor.js";
import type { DurableDedupStore } from "./durable/dedupStore.js";
import type { DurableTaskLedger } from "./durable/ledgerStore.js";
import { deriveTags, type TaggingHints } from "./tagging.js";
import type { RecommendationItem } from "@byok/approval-queue";
import type { RouterTask, RouterTaskInput } from "./types.js";

export class ProductionRouterGuardError extends Error {}

// The router: dispatch -> tag -> dedup -> GATE -> verdict -> executor ->
// APPROVAL QUEUE -> effect (ADR-001's bottom-up handoff at the single-task
// granularity, extended with the fail-closed cost gate ahead of the
// executor per security-architecture.md §6/T4, and the approval queue
// after it per §5/T10 — "the approval queue is the final firewall").
//
// costGate and approvalQueue are both optional in dev/test (existing
// behavior for callers that don't need them is unchanged), but ADR-008:
// production refuses to construct a Router without both.
//
// ADR-039: ledger and dedupStore are the durable, tenant-scoped
// interfaces now (Postgres for any deployed environment) — not the
// synchronous, in-memory TaskLedger/DedupStore this constructor used to
// take. See durable/ledgerStore.ts and durable/dedupStore.ts.
export class Router {
  constructor(
    private readonly ledger: DurableTaskLedger,
    private readonly dedupStore: DurableDedupStore,
    private readonly executor: AgentExecutor,
    private readonly costGate?: CostGate,
    private readonly approvalQueue?: ApprovalQueue,
  ) {
    if (isProductionEnvironment() && (!this.costGate || !this.approvalQueue)) {
      throw new ProductionRouterGuardError(
        "Router cannot be constructed in production (NODE_ENV=production or PRODUCTION=true) without both " +
          "a CostGate and an ApprovalQueue attached (ADR-008).",
      );
    }
  }

  async submitTask(input: RouterTaskInput, hints: TaggingHints = {}): Promise<RouterTask> {
    const now = () => new Date().toISOString();
    const tenantId = input.tenantId ?? "default";
    const tags = deriveTags(hints, input.tags ?? []);

    // Atomic get-or-create: the row-level UNIQUE(tenant_id, dedup_key)
    // constraint (durable/dedupStore.ts) is what actually fixes the
    // multi-replica race the old in-memory get()-then-set() pattern could
    // never close — two replicas racing the same dedupKey can't both
    // "win" here. `factory` is only ever invoked if nothing existing was
    // found, so a replayed dedupKey never re-generates a task id/timestamps.
    const { task: createdOrExistingTask, created } = await this.dedupStore.getOrCreate(tenantId, input.dedupKey, () => ({
      id: randomUUID(),
      tenantId,
      subAgentId: input.subAgentId,
      teamId: input.teamId,
      title: input.title,
      payload: input.payload,
      model: input.model,
      tags,
      dedupKey: input.dedupKey,
      sourceOrgChartTaskId: input.sourceOrgChartTaskId,
      createdAt: now(),
      updatedAt: now(),
      status: "pending",
      systemPrompt: input.systemPrompt,
      promptTier: input.promptTier ?? "sub-agent",
    }));
    if (!created) return createdOrExistingTask; // idempotent replay — never re-execute a seen dedupKey
    const task = createdOrExistingTask;

    await this.ledger.append({ tenantId, taskId: task.id, subAgentId: task.subAgentId, status: "pending" });

    // GATE — strictly before the executor. QUEUE/SKIP never reach it.
    let reservation: Reservation | undefined;
    if (this.costGate && input.model) {
      const { verdict, reservation: madeReservation } = await this.costGate.evaluateAndReserve({
        taskId: task.id,
        tenantId,
        roleId: task.teamId,
        taskType: task.subAgentId,
        payload: task.payload,
        model: input.model,
        outputClass: input.outputClass ?? "short-structured",
        batchable: input.batchable ?? true,
      });
      reservation = madeReservation;

      if (verdict.kind === "QUEUE" || verdict.kind === "SKIP") {
        task.status = verdict.kind === "QUEUE" ? "queued" : "skipped";
        task.updatedAt = now();
        await this.dedupStore.update(task);
        await this.ledger.append({
          tenantId,
          taskId: task.id,
          subAgentId: task.subAgentId,
          status: task.status,
          note: verdict.reason,
        });
        return task; // never reaches the executor
      }

      // PROCEED or DOWNGRADE — verdict.model is the (possibly rewritten) model to actually use.
      task.model = verdict.model;
    }

    task.status = "in_progress";
    task.updatedAt = now();
    await this.dedupStore.update(task);
    await this.ledger.append({ tenantId, taskId: task.id, subAgentId: task.subAgentId, status: "in_progress" });

    const outcome = await this.executor.execute(task).catch((err: Error) => ({ error: err.message }) as const);

    task.updatedAt = now();
    if ("error" in outcome) {
      task.status = "failed";
      task.error = outcome.error;
      if (this.costGate && reservation) await this.costGate.release(reservation.id);
      await this.dedupStore.update(task);
      await this.ledger.append({ tenantId, taskId: task.id, subAgentId: task.subAgentId, status: task.status, note: task.error });
      return task;
    }

    // Execution succeeded — the LLM call already happened, so settle the
    // reservation now regardless of what the approval queue decides next
    // (approval gates the EFFECT, not the spend that already occurred).
    task.result = outcome.result;
    if (this.costGate && reservation) await this.costGate.settle(reservation.id, outcome.costUsd ?? reservation.amountUsd);

    // Issue #22: a task that ran without one or more of its required Hands
    // tools connected can only ever be a DRAFT — no real send/post/pay
    // could have happened, no matter what input.effect claimed ahead of
    // time. Forcing effect to undefined here (not upstream at submitTask's
    // caller, which can't know what actually got connected until AFTER
    // execution) is what makes "agents whose Hands aren't connected yet
    // work in draft mode automatically" true rather than just intended.
    if (outcome.missingHands && outcome.missingHands.length > 0) {
      task.missingHands = outcome.missingHands;
    }
    // T10/ADR-004: the CEO agent has no dispatch pathway at all — this is
    // enforced HERE, structurally, before the approval queue is ever
    // reached, not merely by routing to submitRecommendation below (whose
    // RecommendationItem type already can't hold an effect — see
    // approval-queue's types.ts). Two independent layers refusing the same
    // thing is deliberate: "no matter what its prompt becomes" means the
    // guarantee can't depend on a caller remembering not to pass effect for
    // a CEO-tier task.
    const effectiveEffect = task.missingHands || task.promptTier === "ceo" ? undefined : input.effect;

    if (this.approvalQueue) {
      if (task.promptTier === "ceo") {
        const item: RecommendationItem = {
          id: task.id,
          tenantId,
          agentName: input.agentName ?? task.subAgentId,
          roleTitle: task.teamId,
          summary: task.title,
          draft: outcome.result,
          stakesTags: tags,
          createdAt: task.updatedAt,
        };
        await this.approvalQueue.submitRecommendation(item);

        task.status = "awaiting_review";
        task.approvalActionId = task.id;
        task.updatedAt = now();
        await this.dedupStore.update(task);
        await this.ledger.append({
          tenantId,
          taskId: task.id,
          subAgentId: task.subAgentId,
          status: task.status,
          note: "CEO recommendation — guidance only, no dispatch pathway (T10)",
        });
        return task;
      }

      const { queued } = await this.approvalQueue.submitProposedAction({
        id: task.id,
        tenantId,
        agentName: input.agentName ?? task.subAgentId,
        roleTitle: task.teamId,
        taskType: task.subAgentId,
        summary: task.title,
        draft: outcome.result,
        stakesTags: tags,
        effect: effectiveEffect,
        createdAt: task.updatedAt,
      });

      task.status = queued ? "awaiting_review" : "completed";
      task.approvalActionId = task.id;
      task.updatedAt = now();
      await this.dedupStore.update(task);
      await this.ledger.append({
        tenantId,
        taskId: task.id,
        subAgentId: task.subAgentId,
        status: task.status,
        note: task.missingHands
          ? `drafted only — connect ${task.missingHands.join(", ")} to enable real actions`
          : queued
            ? "awaiting human/spot-check review"
            : "auto-approved via earned autonomy",
      });
      return task;
    }

    // No approval queue configured — preserve prior behavior exactly.
    task.status = "completed";
    await this.dedupStore.update(task);
    await this.ledger.append({ tenantId, taskId: task.id, subAgentId: task.subAgentId, status: task.status });
    return task;
  }

  async ledgerFor(tenantId: string, subAgentId: string) {
    return this.ledger.entriesFor(tenantId, subAgentId);
  }
}
