-- ONE COMPANY PER USER (2026-09-03 ask): a user can belong to more than
-- one tenant (organization) via tenant_members, but the product intent
-- is that exactly ONE is their ACTIVE company at a time -- scheduled,
-- dispatching, spending. Every other tenant they belong to stays
-- inactive: visible, listed, never scheduled, never dispatched, no
-- spend. This migration adds the table that tracks which one; the
-- enforcement itself (CostGate/the scheduler refusing to reserve or
-- dispatch for a tenant that isn't anyone's active company) lands in a
-- follow-up PR against ActiveTenantStore.isTenantActive
-- (packages/db/src/activeTenant.ts).
--
-- user_id is the PRIMARY KEY, not a boolean flag column with a partial
-- unique index -- that structurally makes "exactly one active tenant
-- per user" impossible to violate, no CHECK/trigger required.
--
-- Deliberately NOT row-level-secured, same reasoning 0001_init.sql
-- gives for tenants/users: this table is read from two scoping contexts
-- a single RLS policy can't both satisfy at once -- a user's own
-- session (Settings/company-switcher UI, naturally scoped by
-- app.user_id) and the scheduler/CostGate's tenant-scoped dispatch path
-- (scoped by app.tenant_id, with no "current user" in scope at all).
-- Every application access goes through ActiveTenantStore, whose
-- methods each take the relevant id as an explicit parameter -- there's
-- no route that lets a request read or write a row it didn't ask for.
CREATE TABLE IF NOT EXISTS user_active_tenant (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_active_tenant_tenant_id_idx ON user_active_tenant (tenant_id);

-- The backfill below reads tenant_members and audit_log ACROSS every
-- tenant at once (to find, per user, which of their companies has the
-- most recent real activity) -- something no request-scoped
-- withTenantScope/withUserScope call can do by construction. Same
-- narrow, existing, SELECT-only escape hatch scheduler_instrumentation_daily
-- (0010_tenant_tier_and_scheduler.sql) and signup_extraction_batches
-- (0006_...) already carry -- current_setting('app.internal_metrics'),
-- everywhere else gated to the token-gated internal-metrics route, and
-- here to this one-time migration transaction only. FOR SELECT only --
-- never appears in a WITH CHECK, so it grants no write path (see
-- migrate.test.ts's assertion this stays true for every table that
-- carries it).
DROP POLICY IF EXISTS internal_metrics_read ON tenant_members;
CREATE POLICY internal_metrics_read ON tenant_members
  FOR SELECT
  USING (current_setting('app.internal_metrics', true) = 'true');

DROP POLICY IF EXISTS internal_metrics_read ON audit_log;
CREATE POLICY internal_metrics_read ON audit_log
  FOR SELECT
  USING (current_setting('app.internal_metrics', true) = 'true');

-- Backfill: default every existing user's active company to whichever
-- of their tenants has the most recent REAL activity -- audit_log's
-- MAX(at) (the unified cost-gate/approval-queue log: an actual record
-- of things a tenant DID), falling back to tenants.created_at for a
-- tenant with no audit rows yet (onboarded but never dispatched). Never
-- an arbitrary pick, per the explicit ask not to guess for existing
-- multi-org accounts. Idempotent (ON CONFLICT DO NOTHING) like every
-- other migration here -- safe to re-run, and never overwrites a row a
-- later PR's switcher UI already let a user set deliberately.
--
-- set_config's transaction-local (`true`) form is what makes this safe
-- to run on a pooled connection: it reverts automatically at COMMIT
-- rather than sticking on the physical connection for whichever later,
-- unrelated query happens to reuse it from the pool (see
-- tenantContext.ts's UNSET_SCOPE_UUID comment for why that distinction
-- is load-bearing here, not cosmetic) -- so the explicit BEGIN/COMMIT
-- below is required, not decorative.
BEGIN;
SELECT set_config('app.internal_metrics', 'true', true);

INSERT INTO user_active_tenant (user_id, tenant_id, activated_at)
SELECT DISTINCT ON (tm.user_id)
  tm.user_id,
  tm.tenant_id,
  now()
FROM tenant_members tm
JOIN tenants t ON t.id = tm.tenant_id
LEFT JOIN (
  SELECT tenant_id, MAX(at) AS last_activity FROM audit_log GROUP BY tenant_id
) a ON a.tenant_id = tm.tenant_id
ORDER BY tm.user_id, COALESCE(a.last_activity, t.created_at) DESC
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
