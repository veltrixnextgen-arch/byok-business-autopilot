-- Extraction batches are persisted against the SIGNED-UP USER, not a
-- tenant: the idea -> interview -> extraction -> org-chart-reveal flow
-- (Phase B Step 5) runs entirely before any tenant exists, and CAC must
-- be measurable per signup — including users who see their org chart and
-- never create an org at all (ADR-015, docs/DECISIONS.md). RLS here
-- scopes on app.user_id (see src/userContext.ts's withUserScope), the
-- exact same pattern as 0001_init.sql's tenant_id policy on
-- tenant_members, just keyed differently — same defense-in-depth
-- discipline, not application-code WHERE filtering alone.
CREATE TABLE IF NOT EXISTS signup_extraction_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idea TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  org_chart JSONB,
  cost_usd NUMERIC(10, 4),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE signup_extraction_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE signup_extraction_batches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_isolation ON signup_extraction_batches;
CREATE POLICY user_isolation ON signup_extraction_batches
  FOR ALL
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

-- Every read is by user_id (there's no tenant to join through yet) or by
-- primary key — no other access pattern exists for this table.
CREATE INDEX IF NOT EXISTS signup_extraction_batches_user_id_idx ON signup_extraction_batches (user_id);
