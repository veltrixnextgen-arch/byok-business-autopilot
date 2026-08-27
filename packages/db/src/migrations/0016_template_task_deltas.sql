-- Template-learning data capture layer (docs/STATUS.md's "template-
-- learning scoping" item) -- capture ONLY, no aggregation, no cross-
-- tenant reads, no redaction design yet. reassemble/updateOrgChart
-- overwrites the org chart with no history today; every edit's signal
-- (what the template proposed vs. what the tenant actually kept) was
-- lost the moment it happened. This just stops throwing it away.
--
-- User-scoped, not tenant-scoped: the entire idea -> interview ->
-- extraction -> org-chart-reveal -> edit flow (including
-- /batches/:id/reassemble, the only edit surface that writes deltas
-- today) runs entirely before any tenant exists (ADR-015) -- same
-- reasoning, same RLS pattern, as 0004_signup_extraction_batches.sql.
--
-- No REVOKE ALL FROM anon/authenticated here: 0014's ALTER DEFAULT
-- PRIVILEGES (no FOR ROLE clause) already covers every table this
-- connection role creates from here on, this one included.
CREATE TABLE IF NOT EXISTS template_task_deltas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES signup_extraction_batches(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  delta_kind TEXT NOT NULL CHECK (delta_kind IN ('added', 'removed', 'frequency_changed')),
  detail JSONB,
  source TEXT NOT NULL CHECK (source IN ('generation', 'reassemble')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE template_task_deltas ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_task_deltas FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_isolation ON template_task_deltas;
CREATE POLICY user_isolation ON template_task_deltas
  FOR ALL
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

-- Every real access pattern is "all deltas for this user's batch" —
-- no cross-batch or cross-user read exists yet (by design, per scope).
CREATE INDEX IF NOT EXISTS template_task_deltas_batch_id_idx ON template_task_deltas (batch_id);
