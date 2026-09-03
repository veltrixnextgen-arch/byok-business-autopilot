import { zValidator } from "@hono/zod-validator";
import { TIER_DEFAULT_BUDGET_PER_DAY_USD, type OrgChart } from "@byok/contracts";
import { InvalidCeilingError, type TenantCeilingStore } from "@byok/db";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";

export interface CeilingRouteDeps {
  ceilings: Pick<TenantCeilingStore, "get" | "set">;
}

/** The platform default a tenant falls back to until it sets its own
 *  override (issue #15's safety-net step). Defined here (not
 *  dev/devTrustCore.ts) because it's a real product constant this route
 *  always needs, not a dev-only wiring detail — devTrustCore.ts's
 *  ceilingResolver imports it FROM here instead, so it can't drift out of
 *  sync with what this route actually reports as the default. */
export const DEFAULT_MONTHLY_CEILING_USD = 50;

// Phase A item 2 (docs/strategy/runwisely-master-vision.md §12): the
// Spend Protocol's own description promises per-day limits; until now
// CeilingConfig's day-level field existed with nothing populating it. Same
// "generous safety net, not a tight budget" spirit as the monthly default
// above — 10% of it per day, per agent. Real typical spend is roughly
// $3/company/month total across every agent combined (automation-runtime-
// plan.md §7 rule 4), so $5/day on ONE agent is already an order of
// magnitude over normal — this is a runaway-loop backstop, not a budget a
// legitimate agent should ever be expected to approach. Not yet tenant- or
// agent-overridable (no UI/schema for that exists — see the vision doc's
// §9 finding that Agent has no `budget` field); a single platform-wide
// constant, same as this file's other default, until a real per-agent
// value exists to seed it from.
export const DEFAULT_PER_AGENT_PER_DAY_USD = 5;

/** Real per-agent daily ceilings, sourced from each agent's own
 *  `budget.perDayUsd` (Agent, @byok/contracts) — a tier-derived default
 *  until a genuinely per-agent-authored value exists, not a number this
 *  function invents. No org chart yet (pre-extraction, or a tenant somehow
 *  without one) means no entries — every taskType then falls back to
 *  DEFAULT_PER_AGENT_PER_DAY_USD via CeilingConfig.perTaskTypePerDayDefaultUsd,
 *  exactly as before this existed.
 *
 *  `overrides` (AgentBudgetOverrideStore, @byok/db) is the genuinely
 *  per-agent-authored value the doc comment above once said didn't exist —
 *  an entry there wins over the tier default for that one agent.
 *
 *  `agent.budget` can be missing on a stored org chart older than the field
 *  itself — `signup_extraction_batches.org_chart` is a frozen JSONB
 *  snapshot from extraction time, never migrated forward when the Agent
 *  contract gains a field (confirmed live: Acme's own chart, captured
 *  2026-08-07, predates `budget` entirely — every agent had it `null`,
 *  which crashed every single scheduled dispatch for three weeks with no
 *  visible error, since nothing here defended against it). Falling back to
 *  the same `TIER_DEFAULT_BUDGET_PER_DAY_USD[tier]` assembleOrgChart itself
 *  would have assigned keeps this honest — the exact value a fresh chart
 *  gets — rather than inventing a different number. */
export function perAgentDailyCeilingsFromOrgChart(
  orgChart: OrgChart | null | undefined,
  overrides: Record<string, number> = {},
): Record<string, number> {
  if (!orgChart) return {};
  const map: Record<string, number> = {};
  for (const agent of orgChart.agents) {
    map[agent.id] = overrides[agent.id] ?? agent.budget?.perDayUsd ?? TIER_DEFAULT_BUDGET_PER_DAY_USD[agent.tier];
  }
  return map;
}

const setCeilingSchema = z.object({
  companyMonthlyUsd: z.number().positive().finite(),
});

/**
 * The safety-net step's durable half (issue #15, roles-and-api-key-guide.md
 * Part 3's "2-tap safety net" — our monthly ceiling, prefilled and
 * editable). GET always returns a value (the tenant's own override if set,
 * else the platform default) so the UI never has to special-case "nothing
 * set yet" — `isOverride` tells it whether the number came from the tenant
 * or the platform. CostGate's own ceilingResolver (devTrustCore.ts) reads
 * through this SAME TenantCeilingStore, so what a tenant sets here
 * genuinely gates its spend, not just a UI-only preference.
 */
export function ceilingRoute(deps: CeilingRouteDeps) {
  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const tenantId = c.get("tenantId");
      const override = await deps.ceilings.get(tenantId);
      return c.json({
        companyMonthlyUsd: override ?? DEFAULT_MONTHLY_CEILING_USD,
        isOverride: override !== null,
      });
    })
    .post("/", zValidator("json", setCeilingSchema), async (c) => {
      const { companyMonthlyUsd } = c.req.valid("json");
      const tenantId = c.get("tenantId");
      try {
        await deps.ceilings.set(tenantId, companyMonthlyUsd);
      } catch (err) {
        if (err instanceof InvalidCeilingError) return c.json({ error: err.message }, 400);
        throw err;
      }
      return c.json({ companyMonthlyUsd, isOverride: true });
    });
}
