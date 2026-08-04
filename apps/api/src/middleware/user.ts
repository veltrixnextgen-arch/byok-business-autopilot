import type { Auth } from "@byok/auth";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context.js";

/**
 * Like tenantMiddleware, but for routes that only need an authenticated
 * user — no active organization required. The extraction routes (ADR-015)
 * run entirely before any tenant exists; tenantMiddleware's "401 without
 * an active organization" check is correct there but wrong here. userId
 * comes from the server-verified session, never a client-supplied header
 * or path param, same discipline as tenantMiddleware's tenantId.
 */
export function userMiddleware(auth: Auth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "No authenticated session" }, 401);
    }

    c.set("userId", session.user.id);
    c.set("session", session);
    await next();
  };
}
