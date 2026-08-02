import { Hono } from "hono";
import type { AppEnv } from "../context.js";

/**
 * Minimal authenticated route: no product data, just proof that a request
 * carrying a valid session resolves to a tenant-scoped identity end to
 * end (session -> tenantMiddleware -> RLS-scoped request). This is what
 * apps/web's foundation dashboard page calls to prove auth + tenant + API
 * are wired together correctly (Phase B Step 1) — not a real feature.
 */
export const meRoute = new Hono<AppEnv>().get("/", (c) => {
  const session = c.get("session");
  const tenantId = c.get("tenantId");
  return c.json({ userId: session.user.id, email: session.user.email, tenantId });
});
