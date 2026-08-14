import { ApprovalQueue, AutonomyEngine, MockEffectExecutor, PostgresDurableApprovalStore } from "@byok/approval-queue";
import { CostGate, PostgresReservationStore, loadDefaultPricingTable, type PricingTable } from "@byok/cost-gate";
import { PostgresDurableAuditLog, TenantCeilingStore, type PoolLike } from "@byok/db";
import { InMemoryDedupStore, InMemoryTaskLedger, MockExecutor, Router } from "@byok/router";
import { Vault, type HandsCredentialRefresher } from "@byok/vault";
import type { TrustCoreDeps } from "./context.js";
import { DEV_TIER_MODEL_MAP, createDevKms } from "./dev/devTrustCore.js";
import { createGoogleCalendarRefresher, GOOGLE_CALENDAR_SERVICE } from "./oauth/googleCalendar.js";
import { DEFAULT_MONTHLY_CEILING_USD } from "./routes/ceiling.js";

/**
 * ADR-026: the durable counterpart to dev/devTrustCore.ts — same
 * pricing/model-map/ceiling/KMS config (none of that was ever dev-only in
 * substance, see devTrustCore.ts's own comments), but CostGate's
 * reservation store and ApprovalQueue's pending-item store are the real
 * Postgres-backed implementations, not process-local Maps that vanish on
 * restart or can never be seen from outside the process. This is what
 * `start.ts` (staging, and eventually production) constructs; `dev.ts`
 * (local dev) keeps using createDevTrustCore unchanged — this file is
 * new, not a replacement for that one.
 *
 * Router's ledger and dedup store are DELIBERATELY still in-memory here —
 * see docs/DECISIONS.md ADR-026 for why (their durable counterparts
 * implement a different async interface Router's constructor doesn't
 * accept; making them durable is a larger, separate change, tracked in
 * issue TBD). Anyone reading "staging now uses durable trust-core wiring"
 * should not assume that covers the task ledger or dedup store — it does
 * not.
 */
export function createDurableTrustCore(pool: PoolLike, options: { google?: { clientId: string; clientSecret: string } } = {}): TrustCoreDeps {
  const pricingTable: PricingTable = loadDefaultPricingTable();
  const tenantCeilings = new TenantCeilingStore(pool);
  const ceilingResolver = async (tenantId: string) => {
    const override = await tenantCeilings.get(tenantId);
    return {
      companyMonthlyUsd: override ?? DEFAULT_MONTHLY_CEILING_USD,
      perRoleUsd: {},
      perTaskTypeUsd: {},
    };
  };

  const auditLog = new PostgresDurableAuditLog(pool);
  const costGate = new CostGate(pricingTable, ceilingResolver, new PostgresReservationStore(pool, auditLog), DEV_TIER_MODEL_MAP);
  const approvalQueue = new ApprovalQueue(new AutonomyEngine(), new MockEffectExecutor(), undefined, new PostgresDurableApprovalStore(pool, auditLog));
  const ledger = new InMemoryTaskLedger();
  const router = new Router(ledger, new InMemoryDedupStore(), new MockExecutor(), costGate, approvalQueue);

  const handsCredentialRefreshers = new Map<string, HandsCredentialRefresher>();
  if (options.google) {
    handsCredentialRefreshers.set(GOOGLE_CALENDAR_SERVICE, createGoogleCalendarRefresher(options.google));
  }
  const vault = new Vault(createDevKms(), undefined, undefined, handsCredentialRefreshers);

  return { router, costGate, approvalQueue, ledger, vault, tierModelMap: DEV_TIER_MODEL_MAP };
}
