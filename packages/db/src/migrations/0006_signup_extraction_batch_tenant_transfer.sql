-- Issue #38: the org chart is claimed by a tenant at the earliest point
-- that exists today (org creation), structured so the SAME mechanism
-- moves to Charter acceptance (#16) without rework once that screen
-- exists — see ADR-015 (docs/DECISIONS.md), which explicitly assigned
-- this gap to issue #38.
--
-- Adds a nullable tenant_id to signup_extraction_batches and replaces
-- 0005_signup_metrics.sql's user_isolation policy (USING
-- user_id = app.user_id OR app.internal_metrics) with three branches:
--   - unclaimed rows (tenant_id IS NULL) stay visible only to the owning
--     user's own session (app.user_id) — the pre-org access guard is
--     completely unchanged for a row that hasn't been claimed yet.
--   - claimed rows (tenant_id IS NOT NULL) become visible only to that
--     tenant's session (app.tenant_id), exactly like every other
--     tenant-scoped table. The user_id path is CLOSED the moment a row
--     is claimed, not left open as a lingering side door — even the
--     original user can no longer read it via app.user_id once claimed.
--   - the internal_metrics escape hatch (0005) is preserved unchanged —
--     read-only, never in WITH CHECK, same as before.
ALTER TABLE signup_extraction_batches
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS user_isolation ON signup_extraction_batches;
DROP POLICY IF EXISTS owner_isolation ON signup_extraction_batches;
CREATE POLICY owner_isolation ON signup_extraction_batches
  FOR ALL
  USING (
    (tenant_id IS NULL AND user_id = current_setting('app.user_id', true)::uuid)
    OR (tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid)
    OR current_setting('app.internal_metrics', true) = 'true'
  )
  WITH CHECK (
    (tenant_id IS NULL AND user_id = current_setting('app.user_id', true)::uuid)
    OR (tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid)
  );

CREATE INDEX IF NOT EXISTS signup_extraction_batches_tenant_id_idx
  ON signup_extraction_batches (tenant_id) WHERE tenant_id IS NOT NULL;

-- One claimed org chart per tenant, enforced at the database level, not
-- just in application code — a tenant can never end up with two
-- cross-claimed extraction batches even under a bug or a race in the
-- claim operation itself (see claimLatestForTenant in
-- signupExtractionBatches.ts, which also guards this at the app layer,
-- but this is the actual backstop).
CREATE UNIQUE INDEX IF NOT EXISTS signup_extraction_batches_tenant_id_unique
  ON signup_extraction_batches (tenant_id) WHERE tenant_id IS NOT NULL;
