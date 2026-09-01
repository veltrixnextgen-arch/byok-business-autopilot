import { zValidator } from "@hono/zod-validator";
import type { SignupExtractionBatchStore, AgentBudgetOverrideStore } from "@byok/db";
import { InvalidAgentBudgetError } from "@byok/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";

export interface AgentBudgetsRouteDeps {
  batchStore: Pick<SignupExtractionBatchStore, "latestForTenant">;
  overrides: Pick<AgentBudgetOverrideStore, "getAll" | "set">;
}

/**
 * North star doc Tier 1 item 3: the missing product surface for the
 * per-role budget ceiling AgentsScreen.tsx has, until now, only ever been
 * able to display read-only (agent.budget.perDayUsd, always
 * source: "tier-default"). GET returns every agent's current effective
 * ceiling plus where it came from; POST sets one agent's override, which
 * ceilingResolver (durableTrustCore.ts/devTrustCore.ts) reads through the
 * same AgentBudgetOverrideStore so this genuinely gates spend, not just a
 * UI-only preference — same pattern ceilingRoute.ts already established
 * for the company-wide ceiling.
 */
const setAgentBudgetSchema = z.object({
  perDayUsd: z.number().positive().finite(),
});

export function agentBudgetsRoute(deps: AgentBudgetsRouteDeps) {
  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const tenantId = c.get("tenantId");
      const [batch, overrides] = await Promise.all([deps.batchStore.latestForTenant(tenantId), deps.overrides.getAll(tenantId)]);
      const agents = (batch?.orgChart?.agents ?? []).map((agent) => {
        const override = overrides[agent.id];
        return {
          agentId: agent.id,
          name: agent.name,
          title: agent.title,
          perDayUsd: override ?? agent.budget.perDayUsd,
          source: override !== undefined ? ("override" as const) : agent.budget.source,
        };
      });
      return c.json({ agents });
    })
    .post("/:agentId", zValidator("json", setAgentBudgetSchema), async (c) => {
      const tenantId = c.get("tenantId");
      const agentId = c.req.param("agentId");
      const { perDayUsd } = c.req.valid("json");
      try {
        await deps.overrides.set(tenantId, agentId, perDayUsd);
      } catch (err) {
        if (err instanceof InvalidAgentBudgetError) return c.json({ error: err.message }, 400);
        throw err;
      }
      return c.json({ agentId, perDayUsd, source: "override" });
    });
}
