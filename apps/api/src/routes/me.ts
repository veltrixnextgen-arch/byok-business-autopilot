import type { SignupExtractionBatchStore } from "@byok/db";
import { Hono } from "hono";
import type { AppEnv } from "../context.js";

export interface MeRouteDeps {
  batchStore: Pick<SignupExtractionBatchStore, "claimLatestForTenant" | "latestForTenant">;
}

/**
 * Minimal authenticated route: no product data on GET /, just proof that a
 * request carrying a valid session resolves to a tenant-scoped identity
 * end to end (session -> tenantMiddleware -> RLS-scoped request) — Phase B
 * Step 1's foundation check, not a real feature.
 *
 * claim-org-chart and org-chart (issue #38) are real: the org-chart ->
 * tenant handoff ADR-015 deferred. Both live under tenantMiddleware (an
 * active organization is required for either to mean anything), and both
 * take userId/tenantId only from the server-verified session
 * (c.get("session")/c.get("tenantId")), never a request body or param.
 */
export function meRoute(deps: MeRouteDeps) {
  return new Hono<AppEnv>()
    .get("/", (c) => {
      const session = c.get("session");
      const tenantId = c.get("tenantId");
      return c.json({ userId: session.user.id, email: session.user.email, tenantId });
    })
    // Triggered today right after org creation (OnboardingScreen.tsx, the
    // earliest point a tenant exists) — structured as its own idempotent
    // operation so the Charter-acceptance screen (#16) can call the exact
    // same endpoint later without this route or its logic changing at
    // all, just the caller.
    .post("/claim-org-chart", async (c) => {
      const session = c.get("session");
      const tenantId = c.get("tenantId");
      const batch = await deps.batchStore.claimLatestForTenant(session.user.id, tenantId);
      return c.json({ batch });
    })
    // The post-claim read path — DashboardScreen/OrgChartScreen use this
    // once an organization exists instead of the pre-org, user-scoped
    // /extraction/batches/latest, which can no longer see a claimed row
    // (migrations/0006_signup_extraction_batch_tenant_transfer.sql closes
    // that path the moment tenant_id is set).
    .get("/org-chart", async (c) => {
      const tenantId = c.get("tenantId");
      const batch = await deps.batchStore.latestForTenant(tenantId);
      return c.json({ batch });
    });
}
