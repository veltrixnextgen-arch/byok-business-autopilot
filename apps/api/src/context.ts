import type { ApprovalQueue } from "@byok/approval-queue";
import type { Auth } from "@byok/auth";
import type { PoolClientLike } from "@byok/db";
import type { CostGate, TierModelMapsByProvider } from "@byok/cost-gate";
import type { Router } from "@byok/router";
import type { Vault } from "@byok/vault";

export type AppSession = Awaited<ReturnType<Auth["api"]["getSession"]>>;

export interface AppVariables {
  tenantId: string;
  dbClient: PoolClientLike;
  session: NonNullable<AppSession>;
  /** Set by userMiddleware for routes that only need an authenticated
   *  user, not a tenant — the pre-org extraction routes (ADR-015), where
   *  tenantMiddleware's "401 without an active organization" check would
   *  be wrong: there is no organization yet by design at that point. */
  userId: string;
}

export interface AppEnv {
  Variables: AppVariables;
}

/**
 * Everything the shell needs from trust-core, threaded in at startup.
 * Every field here is a bare `@byok/*` package import — the public
 * interface (router dispatch, queue resolution, vault lifecycle, gate
 * config). Nothing in apps/api may import a trust-core package's internal
 * path (e.g. `@byok/router/src/router.js`); eslint.config.js's boundary
 * rule fails the build if it ever does. See ADR-009.
 */
export interface TrustCoreDeps {
  router: Router;
  costGate: CostGate;
  approvalQueue: ApprovalQueue;
  /** BYOK Brain/Hands key custody (issue #15/#22, ADR-002). Same
   *  single-process-dev-honest wiring as the rest of trust-core — see
   *  devTrustCore.ts's own comment on why LocalKms/StagingKms there is
   *  real, not a stub, but resets on restart. */
  vault: Vault;
  /** R3/ADR-025, provider-scoped since ADR-047/scheduled-dispatch
   *  multi-provider follow-up: the same per-provider tier -> model
   *  mapping CostGate was constructed with (devTrustCore.ts's
   *  TIER_MODEL_MAPS_BY_PROVIDER) — the scheduled-dispatch worker needs
   *  it to resolve a task's model the exact same way any other
   *  Router.submitTask caller would, not a second, possibly drifted
   *  mapping of its own. */
  tierModelMaps: TierModelMapsByProvider;
}
