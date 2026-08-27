-- R5 (docs/architecture/automation-runtime-plan.md §4, "Task chains"):
-- a chain paused at an approval gate must persist across a restart, not
-- live only in worker memory — that's the whole point of the explicit
-- "persists, doesn't expire, and resumes on approval" design decision
-- the plan itself calls out. Tenant-scoped, not user-scoped: unlike
-- signup_extraction_batches/template_task_deltas (pre-org, ADR-015),
-- chains only ever run against a real tenant's claimed org chart and
-- its agents — there is no pre-tenant chain.
--
-- steps is JSONB, not a child table: a chain's steps are read and
-- written as one atomic unit on every transition (packages/chains'
-- chainEngine.ts's pure functions all take and return a whole Chain),
-- never queried or filtered by individual step fields — the same
-- reasoning org_chart's own tasks/agents arrays already use on
-- signup_extraction_batches.
CREATE TABLE IF NOT EXISTS task_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trigger_summary TEXT NOT NULL,
  steps JSONB NOT NULL,
  current_step_index INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('running', 'awaiting_approval', 'completed', 'aborted_stale', 'expired', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE task_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_chains FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON task_chains;
CREATE POLICY tenant_isolation ON task_chains
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Every real access pattern: "this tenant's chains" (dashboard/activity
-- views), and the expiry sweep's "every non-terminal chain past its
-- expires_at, across all tenants" (an internal/operator job, not a
-- tenant-scoped read — see TemplateTaskDeltaStore's own precedent for
-- why that kind of cross-tenant sweep is a deliberately separate,
-- narrower access path, not the norm).
CREATE INDEX IF NOT EXISTS task_chains_tenant_id_idx ON task_chains (tenant_id);
CREATE INDEX IF NOT EXISTS task_chains_status_expires_at_idx ON task_chains (status, expires_at);
