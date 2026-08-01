import { randomUUID } from "node:crypto";
import type { CostGate, Reservation } from "@byok/cost-gate";
import type { AgentExecutor } from "./executor.js";
import type { DedupStore } from "./dedup.js";
import type { TaskLedger } from "./ledger.js";
import { deriveTags, type TaggingHints } from "./tagging.js";
import type { RouterTask, RouterTaskInput } from "./types.js";

// The router: dispatch -> tag -> dedup -> GATE -> verdict -> executor
// (ADR-001's bottom-up handoff at the single-task granularity, extended
// with the fail-closed cost gate ahead of the executor per
// security-architecture.md §6 / T4). costGate is optional — a Router
// constructed without one skips gating entirely (existing behavior,
// unchanged), which is what lets the router's own tests stay independent
// of cost-gate machinery.
export class Router {
  constructor(
    private readonly ledger: TaskLedger,
    private readonly dedupStore: DedupStore,
    private readonly executor: AgentExecutor,
    private readonly costGate?: CostGate,
  ) {}

  async submitTask(input: RouterTaskInput, hints: TaggingHints = {}): Promise<RouterTask> {
    const existing = this.dedupStore.get(input.dedupKey);
    if (existing) return existing; // idempotent replay — never re-execute a seen dedupKey

    const now = () => new Date().toISOString();
    const task: RouterTask = {
      id: randomUUID(),
      subAgentId: input.subAgentId,
      teamId: input.teamId,
      title: input.title,
      payload: input.payload,
      model: input.model,
      tags: deriveTags(hints, input.tags ?? []),
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
      const { verdict, reservation: madeReservation } = this.costGate.evaluateAndReserve({
        taskId: task.id,
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
      if (this.costGate && reservation) this.costGate.release(reservation.id);
    } else {
      task.status = "completed";
      task.result = outcome.result;
      // Settle with the executor's reported cost when available, else fall
      // back to the gate's own (upper-bound) estimate rather than leaving
      // the reservation permanently "in flight" and never counted as spend.
      if (this.costGate && reservation) this.costGate.settle(reservation.id, outcome.costUsd ?? reservation.amountUsd);
    }
    this.dedupStore.set(input.dedupKey, task);
    this.ledger.append({
      taskId: task.id,
      subAgentId: task.subAgentId,
      status: task.status,
      at: task.updatedAt,
      note: task.error,
    });

    return task;
  }

  ledgerFor(subAgentId: string) {
    return this.ledger.entriesFor(subAgentId);
  }
}
