import { withTenantScope, type PoolLike } from "@byok/db";
import { isDevOrTestEnvironment } from "@byok/vault";
import type { RouterTask } from "../types.js";

export class DevOnlyDedupStoreGuardError extends Error {}

export interface GetOrCreateResult {
  task: RouterTask;
  /** false means another (possibly concurrent, possibly cross-process)
   *  caller already created this dedupKey — `task` is THEIR task, not a
   *  new one, and the caller must treat this exactly like the existing
   *  in-memory idempotent-replay path: return it, never execute again. */
  created: boolean;
}

/**
 * Tenant-scoped, durable dedup store — #120: replaced the old
 * synchronous, process-local DedupStore, which this codebase no longer
 * has. Where that in-memory version relied on being the only process
 * holding the Map, getOrCreate here is the actual multi-instance fix: the
 * row is created with a UNIQUE(tenant_id, dedup_key) constraint and
 * INSERT ... ON CONFLICT DO NOTHING, so two router processes racing the
 * same dedupKey can't both "win" — exactly one INSERT succeeds, and the
 * loser reads the winner's row back instead of creating a duplicate task.
 */
export interface DurableDedupStore {
  getOrCreate(tenantId: string, dedupKey: string, factory: () => RouterTask): Promise<GetOrCreateResult>;
  update(task: RouterTask): Promise<void>;
  get(tenantId: string, dedupKey: string): Promise<RouterTask | undefined>;
}

export class InMemoryDurableDedupStore implements DurableDedupStore {
  private readonly byKey = new Map<string, RouterTask>();

  // Same reasoning as InMemoryDurableTaskLedger's guard just above in this
  // PR (ADR-028's principle, per #120) — resets on every restart, and its
  // whole job (cross-replica idempotent replay protection) is exactly the
  // guarantee that silently stops holding the moment a second replica
  // exists, which this guard prevents from happening unnoticed in any
  // deployed environment.
  constructor() {
    if (!isDevOrTestEnvironment()) {
      throw new DevOnlyDedupStoreGuardError(
        "InMemoryDurableDedupStore cannot be constructed outside a dev or test environment — " +
          "use PostgresDurableDedupStore for any deployed environment.",
      );
    }
  }

  private key(tenantId: string, dedupKey: string): string {
    return `${tenantId}|${dedupKey}`;
  }

  async getOrCreate(tenantId: string, dedupKey: string, factory: () => RouterTask): Promise<GetOrCreateResult> {
    const k = this.key(tenantId, dedupKey);
    const existing = this.byKey.get(k);
    if (existing) return { task: existing, created: false };

    const task = factory();
    this.byKey.set(k, task);
    return { task, created: true };
  }

  async update(task: RouterTask): Promise<void> {
    this.byKey.set(this.key(task.tenantId, task.dedupKey), task);
  }

  async get(tenantId: string, dedupKey: string): Promise<RouterTask | undefined> {
    return this.byKey.get(this.key(tenantId, dedupKey));
  }
}

interface RouterTaskRow {
  id: string;
  tenant_id: string;
  dedup_key: string;
  sub_agent_id: string;
  team_id: string;
  title: string;
  payload: string;
  model: string | null;
  tags: string[];
  status: string;
  result: string | null;
  error: string | null;
  approval_action_id: string | null;
  source_org_chart_task_id: string | null;
  created_at: string;
  updated_at: string;
  system_prompt: string | null;
  prompt_tier: string;
}

function rowToTask(row: RouterTaskRow): RouterTask {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    dedupKey: row.dedup_key,
    subAgentId: row.sub_agent_id,
    teamId: row.team_id,
    title: row.title,
    payload: row.payload,
    model: row.model ?? undefined,
    tags: row.tags,
    status: row.status as RouterTask["status"],
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    approvalActionId: row.approval_action_id ?? undefined,
    sourceOrgChartTaskId: row.source_org_chart_task_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    systemPrompt: row.system_prompt ?? undefined,
    promptTier: row.prompt_tier as RouterTask["promptTier"],
  };
}

export class PostgresDurableDedupStore implements DurableDedupStore {
  constructor(private readonly pool: PoolLike) {}

  async getOrCreate(tenantId: string, dedupKey: string, factory: () => RouterTask): Promise<GetOrCreateResult> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const task = factory();
      const inserted = (await client.query(
        `INSERT INTO router_tasks (
           id, tenant_id, dedup_key, sub_agent_id, team_id, title, payload, model, tags, status,
           result, error, approval_action_id, source_org_chart_task_id, created_at, updated_at,
           system_prompt, prompt_tier
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (tenant_id, dedup_key) DO NOTHING
         RETURNING *`,
        [
          task.id,
          tenantId,
          dedupKey,
          task.subAgentId,
          task.teamId,
          task.title,
          task.payload,
          task.model ?? null,
          JSON.stringify(task.tags),
          task.status,
          task.result ?? null,
          task.error ?? null,
          task.approvalActionId ?? null,
          task.sourceOrgChartTaskId ?? null,
          task.createdAt,
          task.updatedAt,
          task.systemPrompt ?? null,
          task.promptTier,
        ],
      )) as unknown as { rows: RouterTaskRow[] };

      if (inserted.rows.length > 0) {
        return { task: rowToTask(inserted.rows[0]!), created: true };
      }

      const existing = (await client.query(`SELECT * FROM router_tasks WHERE tenant_id=$1::uuid AND dedup_key=$2`, [
        tenantId,
        dedupKey,
      ])) as unknown as { rows: RouterTaskRow[] };
      return { task: rowToTask(existing.rows[0]!), created: false };
    });
  }

  async update(task: RouterTask): Promise<void> {
    await withTenantScope(this.pool, task.tenantId, async (client) => {
      await client.query(
        `UPDATE router_tasks SET
           status=$1, result=$2, error=$3, approval_action_id=$4, model=$5, updated_at=$6
         WHERE id=$7::uuid AND tenant_id=$8::uuid`,
        [
          task.status,
          task.result ?? null,
          task.error ?? null,
          task.approvalActionId ?? null,
          task.model ?? null,
          task.updatedAt,
          task.id,
          task.tenantId,
        ],
      );
    });
  }

  async get(tenantId: string, dedupKey: string): Promise<RouterTask | undefined> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(`SELECT * FROM router_tasks WHERE tenant_id=$1::uuid AND dedup_key=$2`, [
        tenantId,
        dedupKey,
      ])) as unknown as { rows: RouterTaskRow[] };
      return result.rows[0] ? rowToTask(result.rows[0]) : undefined;
    });
  }
}
