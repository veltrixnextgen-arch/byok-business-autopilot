import { randomUUID } from "node:crypto";
import type { AgentExecutor } from "./executor.js";
import type { DedupStore } from "./dedup.js";
import type { TaskLedger } from "./ledger.js";
import { deriveTags, type TaggingHints } from "./tagging.js";
import type { RouterTask, RouterTaskInput } from "./types.js";

// The router: tag -> dedup -> ledger -> handoff -> ledger, in that order
// (ADR-001's bottom-up handoff at the single-task granularity). This is the
// whole point of "wrapping" open-multi-agent rather than calling it
// directly — none of tagging, dedup, or the audit ledger exist in the
// underlying library.
export class Router {
  constructor(
    private readonly ledger: TaskLedger,
    private readonly dedupStore: DedupStore,
    private readonly executor: AgentExecutor,
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
      tags: deriveTags(hints, input.tags ?? []),
      dedupKey: input.dedupKey,
      sourceOrgChartTaskId: input.sourceOrgChartTaskId,
      createdAt: now(),
      updatedAt: now(),
      status: "pending",
    };

    this.dedupStore.set(input.dedupKey, task);
    this.ledger.append({ taskId: task.id, subAgentId: task.subAgentId, status: "pending", at: task.createdAt });

    task.status = "in_progress";
    task.updatedAt = now();
    this.ledger.append({ taskId: task.id, subAgentId: task.subAgentId, status: "in_progress", at: task.updatedAt });

    const outcome = await this.executor.execute(task).catch((err: Error) => ({ error: err.message }) as const);

    task.updatedAt = now();
    if ("error" in outcome) {
      task.status = "failed";
      task.error = outcome.error;
    } else {
      task.status = "completed";
      task.result = outcome.result;
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
