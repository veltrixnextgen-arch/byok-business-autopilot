-- North star doc Tier 1 item 3 (docs/strategy/runwisely-north-star.md §5):
-- the missing product surface for a genuinely per-agent-authored budget.
-- Agent.budget.perDayUsd (packages/agents/contracts) has always been a
-- tier-derived default (source: "tier-default") — this table is where a
-- real override lands once a founder edits one, keyed by the org chart's
-- own stable agent id (agentType, per assemble.ts), not a surrogate key,
-- since that's the only id this row needs to join against.
CREATE TABLE IF NOT EXISTS agent_budget_overrides (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  per_day_usd NUMERIC NOT NULL CHECK (per_day_usd > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_id)
);

ALTER TABLE agent_budget_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_budget_overrides FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON agent_budget_overrides;
CREATE POLICY tenant_isolation ON agent_budget_overrides
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
