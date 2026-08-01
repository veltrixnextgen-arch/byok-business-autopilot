import type { Auth } from "@byok/auth";
import { withTenantScope, type PoolLike } from "@byok/db";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context.js";

/**
 * Resolves the tenant from the server-verified session's active
 * organization — never from a client-supplied header or path param, which
 * would let any caller simply claim any tenant id. Wraps the rest of the
 * request in withTenantScope so every RLS-policied query issued downstream
 * (via c.get("dbClient")) is scoped to this tenant by Postgres itself, not
 * by application-level discipline (security-architecture.md Ring 1).
 */
export function tenantMiddleware(pool: PoolLike, auth: Auth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const tenantId = session?.session.activeOrganizationId;

    if (!session || !tenantId) {
      return c.json({ error: "No authenticated session with an active tenant" }, 401);
    }

    await withTenantScope(pool, tenantId, async (client) => {
      c.set("tenantId", tenantId);
      c.set("dbClient", client);
      c.set("session", session);
      await next();
    });
  };
}
