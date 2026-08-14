-- Fixes a real idempotency bug in 0006_signup_extraction_batch_tenant_
-- transfer.sql, found live: staging's first redeploy since ADR-022 made
-- migrations run on every boot failed with "policy owner_isolation for
-- table signup_extraction_batches already exists" (CREATE POLICY has no
-- IF NOT EXISTS variant). 0006 drops `user_isolation` before creating
-- `owner_isolation`, but never drops `owner_isolation` itself before
-- re-creating it — the one migration in this file's history that violates
-- migrate.ts's own documented invariant ("every statement in every
-- migration file is written idempotent... safe to re-run against an
-- already-current database"). It was never caught before because staging
-- had never actually been redeployed since 0006 first applied.
--
-- Per migrate.ts's own rule ("never reorder or edit an already-applied
-- [migration] — write a new migration instead"), this re-declares the
-- exact same policy 0006 defined, with the missing DROP guard added —
-- same pattern 0005_signup_metrics.sql already used to re-declare 0004's
-- policy for its own read exception.
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
