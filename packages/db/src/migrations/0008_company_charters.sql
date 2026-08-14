-- R2 (docs/architecture/automation-runtime-plan.md §2, ADR-024): the
-- versioned, tenant-owned Company Charter. A charter DRAFT already exists
-- pre-acceptance, nested inside signup_extraction_batches.org_chart ->
-- onboardingBatch.charterDraft (ADR-013) — this table is where it becomes a
-- real, versioned, editable, tenant-scoped record, created at Charter
-- ACCEPTANCE (the "hand the Charter to [CEO name]" ceremony), the moment
-- ADR-015/issue #38 assigns the org-chart-to-tenant handoff to.
--
-- `cascade` (the three-tier CEO/role-lead/sub-agent prompt set, generated
-- deterministically — see packages/agents/extraction/src/cascade.ts) lives
-- on the same row as a JSONB blob rather than its own table: it's always
-- regenerated wholesale, never queried per-prompt, and this way "the
-- cascade for charter version N" is automatically exactly what's on row N
-- — no separate versioning to keep in sync. Same "one JSONB blob" pattern
-- signup_extraction_batches already uses for the org chart itself.
CREATE TABLE IF NOT EXISTS company_charters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'superseded')),
  content JSONB NOT NULL,
  cascade JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  installed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, version)
);

ALTER TABLE company_charters ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_charters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON company_charters;
CREATE POLICY tenant_isolation ON company_charters
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS company_charters_tenant_id_idx ON company_charters (tenant_id);

-- At most one ACTIVE charter per tenant — the cascade always installs from
-- exactly one authoritative version. Accepting a new version must demote
-- the previously-active row to 'superseded' in the same transaction, or
-- this constraint rejects the insert/update.
CREATE UNIQUE INDEX IF NOT EXISTS company_charters_one_active_per_tenant
  ON company_charters (tenant_id) WHERE status = 'active';
