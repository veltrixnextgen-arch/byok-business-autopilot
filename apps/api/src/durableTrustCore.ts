import { ApprovalQueue, MockEffectExecutor, PostgresDurableApprovalStore, PostgresDurableAutonomyStore } from "@byok/approval-queue";
import { CostGate, PostgresReservationStore, loadDefaultPricingTable, type PricingTable } from "@byok/cost-gate";
import { PostgresDurableAuditLog, SignupExtractionBatchStore, TenantCeilingStore, type PoolLike } from "@byok/db";
import { OpenMultiAgentExecutor, PostgresDurableDedupStore, PostgresDurableTaskLedger, Router } from "@byok/router";
import { PostgresDekRecordStore, PostgresVaultKeyStore, Vault, type HandsCredentialRefresher, type RequesterIdentity } from "@byok/vault";
import type { TrustCoreDeps } from "./context.js";
import { DEV_TIER_MODEL_MAP, TIER_MODEL_MAPS_BY_PROVIDER, createDevKms } from "./dev/devTrustCore.js";
import { createGoogleCalendarRefresher, GOOGLE_CALENDAR_SERVICE } from "./oauth/googleCalendar.js";
import { DEFAULT_MONTHLY_CEILING_USD, DEFAULT_PER_AGENT_PER_DAY_USD, perAgentDailyCeilingsFromOrgChart } from "./routes/ceiling.js";

// Every Router.submitTask caller in this trust core (scheduled dispatch,
// and apps/api/src/routes/tasks.ts's manual submit route) shares this one
// Router instance and therefore this one identity — vault.ts's
// assertRouterServiceIdentity requires exactly `kind: "router-service"`
// for any decryptBrainKey call, and there is currently only one such
// caller class in the system, not one per route.
const ROUTER_SERVICE_IDENTITY: RequesterIdentity = { kind: "router-service", serviceId: "router" };

/**
 * ADR-026: the durable counterpart to dev/devTrustCore.ts — same
 * pricing/model-map/ceiling/KMS config (none of that was ever dev-only in
 * substance, see devTrustCore.ts's own comments), but CostGate's
 * reservation store, ApprovalQueue's pending-item store, and Vault's own
 * key storage are all the real Postgres-backed implementations, not
 * process-local Maps that vanish on restart or can never be seen from
 * outside the process. This is what
 * `start.ts` (staging, and eventually production) constructs; `dev.ts`
 * (local dev) keeps using createDevTrustCore unchanged — this file is
 * new, not a replacement for that one.
 *
 * #120: Router's ledger and dedup store are now PostgresDurableTaskLedger/
 * PostgresDurableDedupStore, not the in-memory ones ADR-026 originally
 * left here — see durable/ledgerStore.ts and durable/dedupStore.ts.
 */
export function createDurableTrustCore(pool: PoolLike, options: { google?: { clientId: string; clientSecret: string } } = {}): TrustCoreDeps {
  const pricingTable: PricingTable = loadDefaultPricingTable();
  const tenantCeilings = new TenantCeilingStore(pool);
  const signupExtractionBatches = new SignupExtractionBatchStore(pool);
  const ceilingResolver = async (tenantId: string) => {
    const override = await tenantCeilings.get(tenantId);
    const batch = await signupExtractionBatches.latestForTenant(tenantId);
    return {
      companyMonthlyUsd: override ?? DEFAULT_MONTHLY_CEILING_USD,
      perRoleUsd: {},
      perTaskTypeUsd: {},
      perTaskTypePerDayUsd: perAgentDailyCeilingsFromOrgChart(batch?.orgChart),
      perTaskTypePerDayDefaultUsd: DEFAULT_PER_AGENT_PER_DAY_USD,
    };
  };

  // #149/#150: one shared PostgresDurableAuditLog instance, written to by
  // Vault's own audit trail, CostGate's own decision trail, AND the
  // reservation-level/approval-level events PostgresReservationStore /
  // PostgresDurableApprovalStore already logged — same table
  // (migrations/0002_durable_storage.sql's audit_log), differentiated by
  // the `source` column ("vault" / "cost-gate" / "approval-queue").
  const auditLog = new PostgresDurableAuditLog(pool);
  const costGate = new CostGate(pricingTable, ceilingResolver, new PostgresReservationStore(pool, auditLog), TIER_MODEL_MAPS_BY_PROVIDER, auditLog);
  // Autonomy durability: PostgresDurableAutonomyStore, not the in-memory
  // AutonomyEngine this used to be — this closes the accept-offer
  // split-brain (apps/api/src/routes/approvals.ts's own doc comment on
  // ApprovalsRouteDeps used to describe it as a known, deliberate gap):
  // accepting an offer durably recorded active=true in this exact table,
  // but live dispatch gating (submitProposedAction) read a completely
  // separate, in-memory engine that reset on every restart and could
  // never see it. There is now exactly one autonomy store, and it's this
  // one — the same instance apps/api/src/index.ts wires into the
  // approvals route below, not a second one constructed there.
  const autonomyStore = new PostgresDurableAutonomyStore(pool);
  const approvalQueue = new ApprovalQueue(autonomyStore, new MockEffectExecutor(), undefined, new PostgresDurableApprovalStore(pool, auditLog));
  const ledger = new PostgresDurableTaskLedger(pool);

  const handsCredentialRefreshers = new Map<string, HandsCredentialRefresher>();
  if (options.google) {
    handsCredentialRefreshers.set(GOOGLE_CALENDAR_SERVICE, createGoogleCalendarRefresher(options.google));
  }
  // Constructed before the Router below — the executor needs it. Vault
  // durability (found during MVP-1 readiness audit): key records and the
  // per-tenant DEK that encrypts them are both real Postgres now, not the
  // plain in-memory Maps that silently lost every stored key on every
  // restart/redeploy before this — see durable/vaultKeyStore.ts and
  // durable/dekRecordStore.ts's own module comments.
  const vault = new Vault(
    createDevKms(),
    auditLog,
    undefined,
    handsCredentialRefreshers,
    undefined,
    new PostgresVaultKeyStore(pool),
    new PostgresDekRecordStore(pool),
  );

  // Real execution: every task submitted through this Router now resolves
  // the tenant's own stored Brain key and calls a real model, not
  // MockExecutor's stub string. task.model (set by the cost gate before
  // execute() is ever called — see openMultiAgentExecutor.ts's own
  // comment) always wins over the fixed model here; DEV_TIER_MODEL_MAP.T1
  // is only a fallback for the theoretical no-CostGate case, which never
  // happens in this durable wiring (costGate is always passed to Router
  // below). No handsVault/handsTools yet — draft-only for all of
  // MVP-1/Phase 2 is now a settled decision, not an open "TBD" (ADR-043):
  // every scheduled task's RouterTaskInput already omits `effect`
  // entirely regardless, so omitting Hands here doesn't change what can
  // dispatch today, only keeps this executor's tool surface at zero
  // until the ADR's gates (real pilot usage, a Hands connection actually
  // usable in production) clear.
  const executor = new OpenMultiAgentExecutor(vault, ROUTER_SERVICE_IDENTITY, DEV_TIER_MODEL_MAP.T1);
  const router = new Router(ledger, new PostgresDurableDedupStore(pool), executor, costGate, approvalQueue);

  return { router, costGate, approvalQueue, vault, tierModelMaps: TIER_MODEL_MAPS_BY_PROVIDER };
}
