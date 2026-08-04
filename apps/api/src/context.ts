import type { ApprovalQueue } from "@byok/approval-queue";
import type { Auth } from "@byok/auth";
import type { PoolClientLike } from "@byok/db";
import type { CostGate } from "@byok/cost-gate";
import type { Router, TaskLedger } from "@byok/router";

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
  /** The same TaskLedger instance the Router above wraps — exposed
   *  directly because the extraction batch (ADR-014) appends to it
   *  without going through Router.submitTask's approval-queue coupling,
   *  which exists for real agent actions with potential real-world
   *  effects, not a read-only document like an org chart. */
  ledger: TaskLedger;
}
