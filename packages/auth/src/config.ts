import type { Database, PoolLike } from "@byok/db";
import { tenants, users, withTenantScope } from "@byok/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";
import * as authSchema from "./schema.js";

export interface AuthConfigOptions {
  db: Database;
  /** Same pool `db` wraps — needed separately because tenant_members has
   *  FORCE ROW LEVEL SECURITY, and inserting into it requires a connection
   *  with app.tenant_id already set (withTenantScope), which a plain
   *  Database handle can't do on its own. */
  pool: PoolLike;
  baseURL: string;
  secret: string;
  /** Origins apps/web may be served from (different port/domain in dev) —
   *  Better Auth's own CORS/CSRF origin check trusts baseURL by default,
   *  but a browser client on a different origin needs to be added
   *  explicitly or its requests are rejected before hono/cors even runs. */
  trustedOrigins?: string[];
  /** True when apps/web and apps/api are on genuinely different sites (not
   *  just different ports of the same host, e.g. staging's vercel.app vs
   *  railway.app) — the session cookie's default SameSite=Lax is never
   *  sent on cross-site fetch() calls, only top-level navigations, so the
   *  browser silently drops the session on every API call. SameSite=None
   *  requires Secure (HTTPS-only), which breaks local dev's
   *  http://localhost — hence this being an explicit opt-in, not the
   *  default. */
  crossSiteCookies?: boolean;
}

/**
 * Better Auth owns its own identity tables (user/session/account/
 * verification/organization/member/invitation/twoFactor — generated via
 * `npx @better-auth/cli generate` against this config, not hand-defined in
 * packages/db/schema.ts). Our tenants/tenant_members tables (packages/db)
 * are the RLS-enforced source of truth that tenant-scoped business data
 * joins against; the organizationHooks below keep the two in sync whenever
 * Better Auth's organization plugin creates a tenant (org) or membership.
 *
 * generateId: "uuid" is required so organization/member ids are valid
 * uuids — tenant_members.tenant_id is a `uuid` column and the RLS policy
 * casts current_setting('app.tenant_id')::uuid, so a non-uuid id here
 * would break inserts and the isolation check alike.
 *
 * schema.ts is generated (via `npx @better-auth/cli generate` against this
 * exact config), not hand-authored — the Drizzle adapter needs the actual
 * pgTable objects, not just matching tables in Postgres, to build queries;
 * omitting `schema` here throws `The model "user" was not found in the
 * schema object` at request time even though the tables exist.
 */
export function createAuth(options: AuthConfigOptions) {
  return betterAuth({
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(options.db, { provider: "pg", schema: authSchema }),
    advanced: {
      database: {
        generateId: "uuid",
      },
      ...(options.crossSiteCookies
        ? { defaultCookieAttributes: { sameSite: "none" as const, secure: true, partitioned: true } }
        : {}),
    },
    // Better Auth's own `user` table (schema.ts) is a separate table from
    // this project's `users` (packages/db/schema.ts) — same person, two
    // rows, two id spaces, unless kept in sync. Without this, the very
    // first org a user creates fails: afterAddMember below inserts into
    // tenant_members using Better Auth's user.id, and that column has an
    // FK against users.id — a row that, without this hook, never existed.
    // Mirrors the afterCreateOrganization/afterAddMember pattern already
    // used for organization -> tenants.
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string; email: string; name: string }) => {
            await options.db.insert(users).values({ id: user.id, email: user.email, name: user.name }).onConflictDoNothing();
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
    },
    session: {
      additionalFields: {
        // Populated only by a future POST /step-up/verify route once a
        // real TOTP/WebAuthn re-verification succeeds (auth.api.verifyTOTP
        // et al.) — never client-writable. Read by apps/api's
        // requireStepUp middleware to gate the four STEP_UP_OPERATIONS
        // (see stepUp.ts) even though that verify route doesn't exist yet.
        stepUpVerifiedAt: { type: "number", required: false, input: false },
        stepUpMethod: { type: "string", required: false, input: false },
      },
    },
    plugins: [
      organization({
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org }: { organization: { id: string; slug: string; name: string } }) => {
            await options.db.insert(tenants).values({ id: org.id, slug: org.slug, name: org.name }).onConflictDoNothing();
          },
          afterAddMember: async ({
            member,
          }: {
            member: { organizationId: string; userId: string; role: string };
          }) => {
            // tenant_members has FORCE ROW LEVEL SECURITY — inserting via
            // the plain `options.db` handle (no app.tenant_id set) fails
            // its WITH CHECK outright ("new row violates row-level
            // security policy"), caught only by actually trying this
            // against real Postgres. withTenantScope sets app.tenant_id to
            // the new member's own tenant before the insert runs. Raw SQL
            // (bound params, never interpolation — same discipline as
            // tenantContext.ts) rather than the Drizzle query builder:
            // withTenantScope's client is a deliberately minimal
            // structural interface, not a real pg.PoolClient, so it can't
            // be wrapped in drizzle() directly.
            await withTenantScope(options.pool, member.organizationId, async (client) => {
              await client.query(
                "INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                [member.organizationId, member.userId, member.role],
              );
            });
          },
        },
      }),
      // MFA (TOTP) enrollment — security-architecture.md T6 requires this
      // before any of the STEP_UP_OPERATIONS (see stepUp.ts) can proceed.
      twoFactor(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
