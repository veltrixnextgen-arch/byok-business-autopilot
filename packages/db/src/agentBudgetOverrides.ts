import { withTenantScope, type PoolLike } from "./tenantContext.js";

/**
 * North star doc Tier 1 item 3: the durable half of a real, per-agent-
 * authored budget override — Agent.budget.perDayUsd (@byok/contracts) is
 * otherwise always a tier-derived default (source: "tier-default"). Same
 * shape as TenantCeilingStore (tenantCeiling.ts), one level more specific
 * (keyed by agent, not just tenant).
 */
export class AgentBudgetOverrideStore {
  constructor(private readonly pool: PoolLike) {}

  /** All overrides for a tenant, keyed by agent id — empty map means no
   *  agent has one set, never a missing-tenant error. */
  async getAll(tenantId: string): Promise<Record<string, number>> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(`SELECT agent_id, per_day_usd FROM agent_budget_overrides WHERE tenant_id = $1::uuid`, [
        tenantId,
      ])) as unknown as { rows: Array<{ agent_id: string; per_day_usd: string }> };
      const map: Record<string, number> = {};
      for (const row of result.rows) map[row.agent_id] = Number(row.per_day_usd);
      return map;
    });
  }

  async set(tenantId: string, agentId: string, perDayUsd: number): Promise<void> {
    if (!Number.isFinite(perDayUsd) || perDayUsd <= 0) {
      throw new InvalidAgentBudgetError(perDayUsd);
    }
    await withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO agent_budget_overrides (tenant_id, agent_id, per_day_usd, updated_at)
         VALUES ($1::uuid, $2, $3, now())
         ON CONFLICT (tenant_id, agent_id) DO UPDATE SET per_day_usd = $3, updated_at = now()`,
        [tenantId, agentId, perDayUsd],
      );
    });
  }
}

export class InvalidAgentBudgetError extends Error {
  constructor(value: number) {
    super(`Invalid per-agent daily budget: ${value}. Must be a finite number greater than 0.`);
    this.name = "InvalidAgentBudgetError";
  }
}
