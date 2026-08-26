-- Supabase migration (2026-08-26): Supabase grants anon/authenticated
-- (the roles its own public REST API/PostgREST layer connects as after
-- JWT verification) broad default privileges -- SELECT/INSERT/UPDATE/
-- DELETE/TRUNCATE/REFERENCES/TRIGGER -- on every table in the public
-- schema, confirmed directly via information_schema.role_table_grants
-- against the real project. This app never uses Supabase's Auth or
-- Data API layer (Better Auth handles auth, app_user connects directly
-- over plain Postgres) -- those grants are pure unused attack surface,
-- and on the 10 tables 0013 just correctly took out of RLS (tenants,
-- users, Better Auth's own tables), combined with RLS-off this would
-- have meant anyone holding the project's public anon key could read or
-- write tenant and session data directly through Supabase's REST API,
-- with zero application-level auth in the way. RLS-protected tables are
-- separately safe regardless (a policy-scoped session with no
-- app.tenant_id/app.user_id set reads zero rows), but revoking here too
-- is defense-in-depth: these roles should have no reason to touch any
-- table this schema owns, protected or not.
--
-- Idempotent: REVOKE on a grant that doesn't exist is a no-op, so this
-- is safe to re-run and portable to Neon (where anon/authenticated
-- don't exist at all -- see the DO block below).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
  END IF;
END
$$;
