-- Supabase migration (2026-08-26): Supabase auto-enables Row Level
-- Security on every new table created in the public schema (its own
-- `rls_auto_enable()` trigger function, confirmed via `pg_class.
-- relrowsecurity` and Supabase's own security advisor) -- a platform
-- default Neon never had. This silently applied RLS-with-zero-policies
-- to every table this codebase deliberately never protects:
--   - tenants, users (0001_init.sql's own comment: "deliberately NOT
--     row-level-secured... tenants is the root of the isolation
--     boundary... users are shared identities").
--   - Better Auth's eight tables (0003_better_auth.sql: account,
--     invitation, member, organization, session, two_factor, user,
--     verification) -- accessed through Better Auth's own internal
--     logic, never through withTenantScope/withUserScope.
--
-- RLS enabled with no policy and no FORCE means non-owner roles (our
-- app_user, deliberately never the table owner -- see 0001's own
-- comment on why the app's connection role must be a plain, restricted
-- role) get a silent, total deny on every read and write. Left
-- unfixed, this breaks tenant creation and the entire auth flow outright
-- the moment app_user is used, not a subtle bug -- caught here by
-- checking pg_class directly against the real, deployed database rather
-- than assuming migrations behave identically across providers.
--
-- Idempotent by construction: DISABLE ROW LEVEL SECURITY on a table
-- that never had it enabled (e.g. on Neon, which has no such default)
-- is a harmless no-op, so this migration is safe and portable to run
-- against either provider.
ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE account DISABLE ROW LEVEL SECURITY;
ALTER TABLE invitation DISABLE ROW LEVEL SECURITY;
ALTER TABLE member DISABLE ROW LEVEL SECURITY;
ALTER TABLE organization DISABLE ROW LEVEL SECURITY;
ALTER TABLE session DISABLE ROW LEVEL SECURITY;
ALTER TABLE two_factor DISABLE ROW LEVEL SECURITY;
ALTER TABLE "user" DISABLE ROW LEVEL SECURITY;
ALTER TABLE verification DISABLE ROW LEVEL SECURITY;
