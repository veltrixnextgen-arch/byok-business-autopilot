import { withTenantScope, type PoolLike } from "@byok/db";
import { isDevOrTestEnvironment } from "@byok/vault";
import type { Chain, ChainStatus, ChainStep } from "../types.js";

export class DevOnlyChainStoreGuardError extends Error {}
export class UnknownChainError extends Error {}

/**
 * Durable counterpart to the pure chainEngine.ts functions — those take
 * and return a whole `Chain`, so the natural store shape mirrors that:
 * `get` + whole-object `save` (read-modify-write), the same pattern
 * SignupExtractionBatchStore.updateOrgChart already uses for its own
 * chart-shaped JSONB column, not a field-by-field UPDATE API. `create`
 * is separate because it's the one call that doesn't yet have an id.
 */
export interface DurableChainStore {
  create(chain: Omit<Chain, "id">): Promise<Chain>;
  get(tenantId: string, id: string): Promise<Chain | null>;
  save(chain: Chain): Promise<void>;
  listByTenant(tenantId: string): Promise<Chain[]>;
}

export class InMemoryDurableChainStore implements DurableChainStore {
  private readonly chains = new Map<string, Chain>();
  private nextId = 1;

  constructor() {
    // Same construction guard as InMemoryDurableAutonomyStore/
    // InMemoryDurableReservationStore (ADR-026/ADR-028's principle: the
    // guard lands with the fix, never bolted on after a real incident) —
    // a chain paused at an approval gate that vanishes on restart is
    // exactly the failure automation-runtime-plan.md §4's "persists,
    // doesn't expire" design decision exists to rule out.
    if (!isDevOrTestEnvironment()) {
      throw new DevOnlyChainStoreGuardError(
        "InMemoryDurableChainStore cannot be constructed outside a dev or test environment — " +
          "use PostgresChainStore for any deployed environment.",
      );
    }
  }

  async create(chain: Omit<Chain, "id">): Promise<Chain> {
    const id = `chain-${this.nextId++}`;
    const full: Chain = { ...chain, id };
    this.chains.set(id, full);
    return full;
  }

  async get(tenantId: string, id: string): Promise<Chain | null> {
    const chain = this.chains.get(id);
    return chain && chain.tenantId === tenantId ? chain : null;
  }

  async save(chain: Chain): Promise<void> {
    if (!this.chains.has(chain.id)) throw new UnknownChainError(`No chain "${chain.id}".`);
    this.chains.set(chain.id, chain);
  }

  async listByTenant(tenantId: string): Promise<Chain[]> {
    return [...this.chains.values()].filter((c) => c.tenantId === tenantId);
  }
}

interface ChainRow {
  id: string;
  tenant_id: string;
  trigger_summary: string;
  steps: ChainStep[];
  current_step_index: number;
  status: ChainStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

function rowToChain(row: ChainRow): Chain {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    triggerSummary: row.trigger_summary,
    steps: row.steps,
    currentStepIndex: row.current_step_index,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

const SELECT_COLUMNS = "id, tenant_id, trigger_summary, steps, current_step_index, status, created_at, updated_at, expires_at";

export class PostgresChainStore implements DurableChainStore {
  constructor(private readonly pool: PoolLike) {}

  async create(chain: Omit<Chain, "id">): Promise<Chain> {
    return withTenantScope(this.pool, chain.tenantId, async (client) => {
      const result = (await client.query(
        `INSERT INTO task_chains (tenant_id, trigger_summary, steps, current_step_index, status, created_at, updated_at, expires_at)
         VALUES ($1::uuid, $2, $3::jsonb, $4, $5, $6, $7, $8)
         RETURNING ${SELECT_COLUMNS}`,
        [chain.tenantId, chain.triggerSummary, JSON.stringify(chain.steps), chain.currentStepIndex, chain.status, chain.createdAt, chain.updatedAt, chain.expiresAt],
      )) as unknown as { rows: ChainRow[] };
      return rowToChain(result.rows[0]!);
    });
  }

  async get(tenantId: string, id: string): Promise<Chain | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT ${SELECT_COLUMNS} FROM task_chains WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        [id, tenantId],
      )) as unknown as { rows: ChainRow[] };
      return result.rows[0] ? rowToChain(result.rows[0]) : null;
    });
  }

  /** Whole-object read-modify-write, same as SignupExtractionBatchStore's
   *  updateOrgChart — every chainEngine.ts transition already produces a
   *  full, self-consistent Chain, so there's nothing to gain from a
   *  field-by-field UPDATE and a real risk of writing a `steps`/`status`
   *  combination the pure engine functions would never have produced
   *  together. */
  async save(chain: Chain): Promise<void> {
    await withTenantScope(this.pool, chain.tenantId, async (client) => {
      const result = (await client.query(
        `UPDATE task_chains
         SET trigger_summary = $3, steps = $4::jsonb, current_step_index = $5, status = $6, updated_at = $7, expires_at = $8
         WHERE id = $1::uuid AND tenant_id = $2::uuid
         RETURNING id`,
        [chain.id, chain.tenantId, chain.triggerSummary, JSON.stringify(chain.steps), chain.currentStepIndex, chain.status, chain.updatedAt, chain.expiresAt],
      )) as unknown as { rows: unknown[] };
      if (result.rows.length === 0) throw new UnknownChainError(`No chain "${chain.id}" for tenant "${chain.tenantId}".`);
    });
  }

  async listByTenant(tenantId: string): Promise<Chain[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT ${SELECT_COLUMNS} FROM task_chains WHERE tenant_id = $1::uuid ORDER BY created_at DESC`,
        [tenantId],
      )) as unknown as { rows: ChainRow[] };
      return result.rows.map(rowToChain);
    });
  }
}
