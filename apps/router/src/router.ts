import { randomUUID } from "node:crypto";
import type { CostGate, Reservation } from "@byok/cost-gate";
import { ApprovalQueue } from "@byok/approval-queue";
import { isProductionEnvironment } from "@byok/vault";
import type { AgentExecutor } from "./executor.js";
import type { DedupStore } from "./dedup.js";
import type { TaskLedger } from "./ledger.js";
import { deriveTags, type TaggingHints } from "./tagging.js";
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
export class Router {
  constructor(
    private readonly ledger: TaskLedger,
    private readonly dedupStore: DedupStore,
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
    const existing = this.dedupStore.get(input.dedupKey);
    if (existing) return existing; // idempotent replay — never re-execute a seen dedupKey

    const now = () => new Date().toISOString();
    const tenantId = input.tenantId ?? "default";
    const tags = deriveTags(hints, input.tags ?? []);

    const task: RouterTask = {
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
    };

    this.dedupStore.set(input.dedupKey, task);
    this.ledger.append({ taskId: task.id, subAgentId: task.subAgentId, status: "pending", at: task.createdAt });

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
        this.dedupStore.set(input.dedupKey, task);
        this.ledger.append({
          taskId: task.id,
          subAgentId: task.subAgentId,
          status: task.status,
          at: task.updatedAt,
          note: verdict.reason,
        });
        return task; // never reaches the executor
      }

      // PROCEED or DOWNGRADE — verdict.model is the (possibly rewritten) model to actually use.
      task.model = verdict.model;
    }

    task.status = "in_progress";
    task.updatedAt = now();
    this.ledger.append({ taskId: task.id, subAgentId: task.subAgentId, status: "in_progress", at: task.updatedAt });

    const outcome = await this.executor.execute(task).catch((err: Error) => ({ error: err.message }) as const);

    task.updatedAt = now();
    if ("error" in outcome) {
      task.status = "failed";
      task.error = outcome.error;
      if (this.costGate && reservation) await this.costGate.release(reservation.id);
      this.dedupStore.set(input.dedupKey, task);
      this.ledger.append({ taskId: task.id, subAgentId: task.subAgentId, status: task.status, at: task.updatedAt, note: task.error });
      return task;
    }

    // Execution succeeded — the LLM call already happened, so settle the
    // reservation now regardless of what the approval queue decides next
    // (approval gates the EFFECT, not the spend that already occurred).
    task.result = outcome.result;
    if (this.costGate && reservation) await this.costGate.settle(reservation.id, outcome.costUsd ?? reservation.amountUsd);

    if (this.approvalQueue) {
      const { queued } = await this.approvalQueue.submitProposedAction({
        id: task.id,
        tenantId,
        agentName: input.agentName ?? task.subAgentId,
        roleTitle: task.teamId,
        taskType: task.subAgentId,
        summary: task.title,
        draft: outcome.result,
        stakesTags: tags,
        effect: input.effect,
        createdAt: task.updatedAt,
      });

      task.status = queued ? "awaiting_review" : "completed";
      task.approvalActionId = task.id;
      task.updatedAt = now();
      this.dedupStore.set(input.dedupKey, task);
      this.ledger.append({
        taskId: task.id,
        subAgentId: task.subAgentId,
        status: task.status,
        at: task.updatedAt,
        note: queued ? "awaiting human/spot-check review" : "auto-approved via earned autonomy",
      });
      return task;
    }

    // No approval queue configured — preserve prior behavior exactly.
    task.status = "completed";
    this.dedupStore.set(input.dedupKey, task);
    this.ledger.append({ taskId: task.id, subAgentId: task.subAgentId, status: task.status, at: task.updatedAt });
    return task;
  }

  ledgerFor(subAgentId: string) {
    return this.ledger.entriesFor(subAgentId);
  }
}
