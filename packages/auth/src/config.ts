import type { Database } from "@byok/db";
import { tenantMembers, tenants } from "@byok/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";

export interface AuthConfigOptions {
  db: Database;
  baseURL: string;
  secret: string;
  /** Origins apps/web may be served from (different port/domain in dev) —
   *  Better Auth's own CORS/CSRF origin check trusts baseURL by default,
   *  but a browser client on a different origin needs to be added
   *  explicitly or its requests are rejected before hono/cors even runs. */
  trustedOrigins?: string[];
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
 */
export function createAuth(options: AuthConfigOptions) {
  return betterAuth({
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(options.db, { provider: "pg" }),
    advanced: {
      database: {
        generateId: "uuid",
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
            await options.db
              .insert(tenantMembers)
              .values({ tenantId: member.organizationId, userId: member.userId, role: member.role })
              .onConflictDoNothing();
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
