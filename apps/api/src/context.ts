import type { ApprovalQueue } from "@byok/approval-queue";
import type { Auth } from "@byok/auth";
import type { PoolClientLike } from "@byok/db";
import type { CostGate } from "@byok/cost-gate";
import type { Router } from "@byok/router";

export type AppSession = Awaited<ReturnType<Auth["api"]["getSession"]>>;

export interface AppVariables {
  tenantId: string;
  dbClient: PoolClientLike;
  session: NonNullable<AppSession>;
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
}
