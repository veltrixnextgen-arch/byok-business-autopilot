import { withTenantScope, type PoolLike } from "@byok/db";
import { isDevOrTestEnvironment } from "@byok/vault";
import { isDeniedFromAutonomy } from "../denyList.js";
import { NoPendingOfferError, type AutonomyConfig, DEFAULT_AUTONOMY_CONFIG, type AutonomyState } from "../autonomyEngine.js";

export class DevOnlyAutonomyStoreGuardError extends Error {}

/**
 * Async, tenant-scoped counterpart to AutonomyEngine (autonomyEngine.ts).
 * recordApproval's threshold-offer detection is a single row-locked UPDATE
 * (increment + compare in one statement) so two concurrent approvals for
 * the same (tenant, taskType) can't both observe "count == threshold - 1"
 * and neither emit the offer, or both emit it twice.
 *
 * shouldSpotCheck() is on this interface even though it touches no store
 * state at all — same reasoning as isDeniable() just below it: a pure,
 * stateless decision (this.random() < spotCheckRate) with nothing to
 * persist ("spot-checks run forever," not just during a probation period
 * — there's no state whose durability would even mean anything here), so
 * it stays synchronous. Putting it on this interface keeps ApprovalQueue's
 * dependency surface at one object instead of two, matching isDeniable's
 * existing precedent.
 */
export interface DurableAutonomyStore {
  isActive(tenantId: string, taskType: string): Promise<boolean>;
  isDeniable(stakesTags: readonly string[]): boolean;
  shouldSpotCheck(): boolean;
  recordApproval(tenantId: string, taskType: string, stakesTags: readonly string[]): Promise<{ offered: boolean; consecutiveApprovals: number }>;
  recordRejection(tenantId: string, taskType: string): Promise<void>;
  acceptOffer(tenantId: string, taskType: string): Promise<void>;
  recordSpotCheckRejection(tenantId: string, taskType: string): Promise<void>;
  /** Returns the task types that were ACTUALLY revoked (i.e. were active
   *  before this call) — revoking an already-inactive task type is a
   *  no-op, same as AutonomyEngine.revoke's existing `if (!state.active)
   *  continue`. Callers (ApprovalQueue) need this to emit the right
   *  per-task-type autonomy.revoked events; the store has no event system
   *  of its own to do that internally the way the sync engine did. */
  revoke(tenantId: string, taskType?: string): Promise<{ revokedTaskTypes: string[] }>;
  stateFor(tenantId: string, taskType: string): Promise<AutonomyState>;
}

function emptyState(tenantId: string, taskType: string): AutonomyState {
  return { tenantId, taskType, consecutiveApprovals: 0, active: false };
}

export class InMemoryDurableAutonomyStore implements DurableAutonomyStore {
  private readonly states = new Map<string, AutonomyState>();

  constructor(
    private readonly config: AutonomyConfig = DEFAULT_AUTONOMY_CONFIG,
    /** Injectable RNG — tests pass a seeded/deterministic generator instead
     *  of Math.random so the spot-check sampler is reproducible. Same
     *  parameter AutonomyEngine took. */
    private readonly random: () => number = Math.random,
  ) {
    // Same reasoning as InMemoryDurableApprovalStore's guard (ADR-026,
    // mirrored here per ADR-028's principle: a construction guard lands
    // with the fix, never added after the fact) — this class resets on
    // every restart and nothing outside this process can ever see a
    // tenant's autonomy state held in it. Refusing to construct outside
    // dev/test means a deployed environment that forgets to wire
    // PostgresDurableAutonomyStore fails loudly at boot, not silently
    // loses every tenant's earned autonomy on the next restart.
    if (!isDevOrTestEnvironment()) {
      throw new DevOnlyAutonomyStoreGuardError(
        "InMemoryDurableAutonomyStore cannot be constructed outside a dev or test environment — " +
          "use PostgresDurableAutonomyStore for any deployed environment.",
      );
    }
  }

  private key(tenantId: string, taskType: string): string {
    return `${tenantId}|${taskType}`;
  }

  private getOrCreate(tenantId: string, taskType: string): AutonomyState {
    const k = this.key(tenantId, taskType);
    let state = this.states.get(k);
    if (!state) {
      state = emptyState(tenantId, taskType);
      this.states.set(k, state);
    }
    return state;
  }

  isDeniable(stakesTags: readonly string[]): boolean {
    return isDeniedFromAutonomy(stakesTags);
  }

  shouldSpotCheck(): boolean {
    return this.random() < this.config.spotCheckRate;
  }

  async isActive(tenantId: string, taskType: string): Promise<boolean> {
    return this.getOrCreate(tenantId, taskType).active;
  }

  async recordApproval(
    tenantId: string,
    taskType: string,
    stakesTags: readonly string[],
  ): Promise<{ offered: boolean; consecutiveApprovals: number }> {
    if (this.isDeniable(stakesTags)) return { offered: false, consecutiveApprovals: this.getOrCreate(tenantId, taskType).consecutiveApprovals };

    const state = this.getOrCreate(tenantId, taskType);
    state.consecutiveApprovals += 1;
    const offered = state.consecutiveApprovals === this.config.offerThreshold && !state.active && !state.offeredAt;
    if (offered) state.offeredAt = new Date().toISOString();
    return { offered, consecutiveApprovals: state.consecutiveApprovals };
  }

  async recordRejection(tenantId: string, taskType: string): Promise<void> {
    const state = this.getOrCreate(tenantId, taskType);
    state.consecutiveApprovals = 0;
    state.offeredAt = undefined;
  }

  async acceptOffer(tenantId: string, taskType: string): Promise<void> {
    const state = this.getOrCreate(tenantId, taskType);
    if (!state.offeredAt) throw new NoPendingOfferError(`No pending autonomy offer for tenant "${tenantId}", task type "${taskType}".`);
    state.active = true;
  }

  async recordSpotCheckRejection(tenantId: string, taskType: string): Promise<void> {
    const state = this.getOrCreate(tenantId, taskType);
    state.active = false;
    state.consecutiveApprovals = 0;
    state.offeredAt = undefined;
  }

  async revoke(tenantId: string, taskType?: string): Promise<{ revokedTaskTypes: string[] }> {
    const targets = taskType
      ? [this.getOrCreate(tenantId, taskType)]
      : [...this.states.values()].filter((s) => s.tenantId === tenantId && s.active);

    const revokedTaskTypes: string[] = [];
    for (const state of targets) {
      if (!state.active) continue;
      state.active = false;
      state.consecutiveApprovals = 0;
      state.offeredAt = undefined;
      revokedTaskTypes.push(state.taskType);
    }
    return { revokedTaskTypes };
  }

  async stateFor(tenantId: string, taskType: string): Promise<AutonomyState> {
    return { ...this.getOrCreate(tenantId, taskType) };
  }
}

interface AutonomyRow {
  tenant_id: string;
  task_type: string;
  consecutive_approvals: number;
  active: boolean;
  offered_at: string | null;
}

function rowToState(row: AutonomyRow): AutonomyState {
  return {
    tenantId: row.tenant_id,
    taskType: row.task_type,
    consecutiveApprovals: row.consecutive_approvals,
    active: row.active,
    offeredAt: row.offered_at ?? undefined,
  };
}

export class PostgresDurableAutonomyStore implements DurableAutonomyStore {
  constructor(
    private readonly pool: PoolLike,
    private readonly config: AutonomyConfig = DEFAULT_AUTONOMY_CONFIG,
    /** Same injectable RNG as InMemoryDurableAutonomyStore, for the same
     *  reason — shouldSpotCheck() touches no DB state, so there's nothing
     *  Postgres-specific about it at all. */
    private readonly random: () => number = Math.random,
  ) {}

  isDeniable(stakesTags: readonly string[]): boolean {
    return isDeniedFromAutonomy(stakesTags);
  }

  shouldSpotCheck(): boolean {
    return this.random() < this.config.spotCheckRate;
  }

  async isActive(tenantId: string, taskType: string): Promise<boolean> {
    const state = await this.stateFor(tenantId, taskType);
    return state.active;
  }

  async recordApproval(
    tenantId: string,
    taskType: string,
    stakesTags: readonly string[],
  ): Promise<{ offered: boolean; consecutiveApprovals: number }> {
    if (this.isDeniable(stakesTags)) {
      const state = await this.stateFor(tenantId, taskType);
      return { offered: false, consecutiveApprovals: state.consecutiveApprovals };
    }

    return withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO autonomy_counters (tenant_id, task_type) VALUES ($1::uuid, $2) ON CONFLICT (tenant_id, task_type) DO NOTHING`,
        [tenantId, taskType],
      );

      // Atomic increment: the row lock this UPDATE takes means two
      // concurrent approvals for the same (tenant, task_type) serialize
      // here, so the threshold-crossing check below can never be
      // evaluated against a stale pre-increment count by both callers.
      const result = (await client.query(
        `UPDATE autonomy_counters
         SET consecutive_approvals = consecutive_approvals + 1, updated_at = now()
         WHERE tenant_id = $1::uuid AND task_type = $2
         RETURNING consecutive_approvals, active, offered_at`,
        [tenantId, taskType],
      )) as unknown as { rows: AutonomyRow[] };

      const row = result.rows[0]!;
      const offered = row.consecutive_approvals === this.config.offerThreshold && !row.active && !row.offered_at;
      if (offered) {
        await client.query(`UPDATE autonomy_counters SET offered_at = now() WHERE tenant_id=$1::uuid AND task_type=$2`, [tenantId, taskType]);
      }

      return { offered, consecutiveApprovals: row.consecutive_approvals };
    });
  }

  async recordRejection(tenantId: string, taskType: string): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO autonomy_counters (tenant_id, task_type, consecutive_approvals, offered_at)
         VALUES ($1::uuid, $2, 0, NULL)
         ON CONFLICT (tenant_id, task_type) DO UPDATE SET consecutive_approvals = 0, offered_at = NULL, updated_at = now()`,
        [tenantId, taskType],
      );
    });
  }

  async acceptOffer(tenantId: string, taskType: string): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `UPDATE autonomy_counters SET active = true, updated_at = now()
         WHERE tenant_id=$1::uuid AND task_type=$2 AND offered_at IS NOT NULL
         RETURNING tenant_id`,
        [tenantId, taskType],
      )) as unknown as { rows: unknown[] };
      if (result.rows.length === 0) {
        throw new NoPendingOfferError(`No pending autonomy offer for tenant "${tenantId}", task type "${taskType}".`);
      }
    });
  }

  async recordSpotCheckRejection(tenantId: string, taskType: string): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO autonomy_counters (tenant_id, task_type, consecutive_approvals, active, offered_at)
         VALUES ($1::uuid, $2, 0, false, NULL)
         ON CONFLICT (tenant_id, task_type) DO UPDATE SET consecutive_approvals = 0, active = false, offered_at = NULL, updated_at = now()`,
        [tenantId, taskType],
      );
    });
  }

  async revoke(tenantId: string, taskType?: string): Promise<{ revokedTaskTypes: string[] }> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = taskType
        ? ((await client.query(
            `UPDATE autonomy_counters SET active=false, consecutive_approvals=0, offered_at=NULL, updated_at=now()
             WHERE tenant_id=$1::uuid AND task_type=$2 AND active=true
             RETURNING task_type`,
            [tenantId, taskType],
          )) as unknown as { rows: { task_type: string }[] })
        : ((await client.query(
            `UPDATE autonomy_counters SET active=false, consecutive_approvals=0, offered_at=NULL, updated_at=now()
             WHERE tenant_id=$1::uuid AND active=true
             RETURNING task_type`,
            [tenantId],
          )) as unknown as { rows: { task_type: string }[] });
      return { revokedTaskTypes: result.rows.map((r) => r.task_type) };
    });
  }

  async stateFor(tenantId: string, taskType: string): Promise<AutonomyState> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT tenant_id, task_type, consecutive_approvals, active, offered_at FROM autonomy_counters WHERE tenant_id=$1::uuid AND task_type=$2`,
        [tenantId, taskType],
      )) as unknown as { rows: AutonomyRow[] };
      return result.rows[0] ? rowToState(result.rows[0]) : emptyState(tenantId, taskType);
    });
  }
}
