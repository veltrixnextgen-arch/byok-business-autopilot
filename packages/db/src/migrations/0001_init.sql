-- Tenant isolation via Postgres Row-Level Security (RLS).
--
-- Pattern for every tenant-scoped table (any table with a tenant_id column):
--   1. ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
--   2. ALTER TABLE <t> FORCE ROW LEVEL SECURITY;   -- applies even to the table owner
--   3. CREATE POLICY tenant_isolation ON <t> FOR ALL
--        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
--        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--
-- app.tenant_id is a session-local setting the application sets per request
-- via set_config('app.tenant_id', $1, true) inside a transaction (see
-- ../tenantContext.ts). A session that never sets it, or a query issued
-- outside a tenant-scoped transaction, resolves current_setting(...) to
-- NULL (the `true` "missing_ok" arg avoids an error) and every row fails
-- the comparison — the query returns nothing rather than leaking rows.
--
-- IMPORTANT (production): FORCE ROW LEVEL SECURITY still does not apply to
-- superusers or roles with the BYPASSRLS attribute — those always bypass
-- RLS regardless. The application's database connection role MUST be a
-- plain role (no SUPERUSER, no BYPASSRLS). docker-compose.yml's Postgres
-- service bootstraps its POSTGRES_USER ("byok") as the cluster's initial
-- superuser (a property of the official postgres image's initdb, not
-- something this migration grants) — that's fine for local dev, but any
-- deployed environment MUST create and connect as a separate, non-super
-- role instead of reusing that bootstrap user.

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_members
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- tenants and users are deliberately NOT row-level-secured: tenants is the
-- root of the isolation boundary (an app-layer query resolves the caller's
-- tenant row by id/slug before anything else), and users are shared
-- identities that can belong to multiple tenants via tenant_members, whose
-- rows ARE isolated above.
