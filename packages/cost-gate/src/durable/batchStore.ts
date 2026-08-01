import { withTenantScope, type PoolLike } from "@byok/db";
import { randomUUID } from "node:crypto";
import type { ExhaustionReason, PausedBatchState, SerializedTask } from "../exhaustion.js";

export class UnknownDurablePausedBatchError extends Error {}

export interface PauseInput {
  tenantId: string;
  reason: ExhaustionReason;
  completedTaskIds: string[];
  remainingTasks: SerializedTask[];
  context?: Record<string, unknown>;
}

/**
 * Async, tenant-scoped counterpart to BatchExhaustionManager
 * (exhaustion.ts) — same pause/resume/complete/list contract, backed by
 * paused_batches so a pause survives a process restart and can be resumed
 * by a different router instance than the one that paused it.
 */
export interface DurableBatchStore {
  pause(input: PauseInput): Promise<PausedBatchState>;
  get(tenantId: string, id: string): Promise<PausedBatchState>;
  resume(tenantId: string, id: string): Promise<PausedBatchState>;
  complete(tenantId: string, id: string): Promise<void>;
  list(tenantId: string): Promise<readonly PausedBatchState[]>;
}

export class InMemoryDurableBatchStore implements DurableBatchStore {
  private readonly paused = new Map<string, PausedBatchState & { tenantId: string }>();

  async pause(input: PauseInput): Promise<PausedBatchState> {
    const state: PausedBatchState & { tenantId: string } = {
      id: randomUUID(),
      tenantId: input.tenantId,
      pausedAt: new Date().toISOString(),
      reason: input.reason,
      completedTaskIds: input.completedTaskIds,
      remainingTasks: input.remainingTasks,
      context: input.context,
    };
    this.paused.set(state.id, state);
    return state;
  }

  async get(tenantId: string, id: string): Promise<PausedBatchState> {
    return this.getInternal(tenantId, id);
  }

  async resume(tenantId: string, id: string): Promise<PausedBatchState> {
    return this.getInternal(tenantId, id);
  }

  async complete(tenantId: string, id: string): Promise<void> {
    this.getInternal(tenantId, id);
    this.paused.delete(id);
  }

  async list(tenantId: string): Promise<readonly PausedBatchState[]> {
    return [...this.paused.values()].filter((s) => s.tenantId === tenantId);
  }

  private getInternal(tenantId: string, id: string): PausedBatchState {
    const state = this.paused.get(id);
    if (!state || state.tenantId !== tenantId) throw new UnknownDurablePausedBatchError(`No paused batch "${id}" for tenant "${tenantId}".`);
    return state;
  }
}

interface PausedBatchRow {
  id: string;
  reason: ExhaustionReason;
  completed_task_ids: string[];
  remaining_tasks: SerializedTask[];
  context: Record<string, unknown> | null;
  paused_at: string;
}

function rowToState(row: PausedBatchRow): PausedBatchState {
  return {
    id: row.id,
    pausedAt: row.paused_at,
    reason: row.reason,
    completedTaskIds: row.completed_task_ids,
    remainingTasks: row.remaining_tasks,
    context: row.context ?? undefined,
  };
}

export class PostgresDurableBatchStore implements DurableBatchStore {
  constructor(private readonly pool: PoolLike) {}

  async pause(input: PauseInput): Promise<PausedBatchState> {
    return withTenantScope(this.pool, input.tenantId, async (client) => {
      const result = (await client.query(
        `INSERT INTO paused_batches (tenant_id, reason, completed_task_ids, remaining_tasks, context)
         VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5::jsonb)
         RETURNING id, reason, completed_task_ids, remaining_tasks, context, paused_at`,
        [
          input.tenantId,
          input.reason,
          JSON.stringify(input.completedTaskIds),
          JSON.stringify(input.remainingTasks),
          input.context ? JSON.stringify(input.context) : null,
        ],
      )) as unknown as { rows: PausedBatchRow[] };
      return rowToState(result.rows[0]!);
    });
  }

  async get(tenantId: string, id: string): Promise<PausedBatchState> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT id, reason, completed_task_ids, remaining_tasks, context, paused_at FROM paused_batches WHERE id=$1::uuid AND tenant_id=$2::uuid`,
        [id, tenantId],
      )) as unknown as { rows: PausedBatchRow[] };
      const row = result.rows[0];
      if (!row) throw new UnknownDurablePausedBatchError(`No paused batch "${id}" for tenant "${tenantId}".`);
      return rowToState(row);
    });
  }

  async resume(tenantId: string, id: string): Promise<PausedBatchState> {
    return this.get(tenantId, id);
  }

  async complete(tenantId: string, id: string): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(`DELETE FROM paused_batches WHERE id=$1::uuid AND tenant_id=$2::uuid RETURNING id`, [
        id,
        tenantId,
      ])) as unknown as { rows: Array<{ id: string }> };
      if (result.rows.length === 0) throw new UnknownDurablePausedBatchError(`No paused batch "${id}" for tenant "${tenantId}".`);
    });
  }

  async list(tenantId: string): Promise<readonly PausedBatchState[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT id, reason, completed_task_ids, remaining_tasks, context, paused_at FROM paused_batches WHERE tenant_id=$1::uuid ORDER BY paused_at`,
        [tenantId],
      )) as unknown as { rows: PausedBatchRow[] };
      return result.rows.map(rowToState);
    });
  }
}
