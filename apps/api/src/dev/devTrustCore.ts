import { ApprovalQueue, AutonomyEngine, MockEffectExecutor } from "@byok/approval-queue";
import { CostGate, loadDefaultPricingTable, ReservationLedger, type PricingTable, type TierModelMap } from "@byok/cost-gate";
import { InMemoryDedupStore, InMemoryTaskLedger, MockExecutor, Router } from "@byok/router";
import type { TrustCoreDeps } from "../context.js";

// Model ids here must exactly match packages/cost-gate/src/pricing-table.json
// (loaded below, not hand-duplicated — see loadDefaultPricingTable's own
// comment for why a hand-copied table previously drifted: this repo's T1
// entry was "claude-haiku-4-5", missing the "-20251001" suffix every real
// call — customize.ts, categoryValidator.ts, onboardingBatch.ts — actually
// uses, so cost estimation for the onboarding batch would have silently
// thrown UnknownModelError the moment it ran for real). Exported (not just
// used inline) so devTrustCore.test.ts can assert every model id referenced
// anywhere in this repo has a pricing entry, not just the ones this map
// happens to name.
export const DEV_TIER_MODEL_MAP: TierModelMap = {
  T1: "claude-haiku-4-5-20251001",
  T2: "claude-sonnet-4-6",
  T3: "claude-opus-4-6",
};

export function loadDevPricingTable(): PricingTable {
  return loadDefaultPricingTable();
}

/**
 * Local-dev-only trust-core: real Router/CostGate/ApprovalQueue classes,
 * wired to the same in-memory implementations the trust-core packages'
 * own test suites use — genuinely functional, not a stub, but
 * single-process and reset on every restart. NOT for any deployed
 * environment: production must supply real pricing/ceiling/durable-store
 * config (see server.ts's own comment on why that's deliberately not
 * decided here), and ADR-008's guard refuses to construct a Router in
 * production without a CostGate/ApprovalQueue regardless. This exists so
 * `npm run dev` has something real to run against everywhere else.
 */
export function createDevTrustCore(): TrustCoreDeps {
  const pricingTable = loadDevPricingTable();
  const ceilingConfig = { companyMonthlyUsd: 50, perRoleUsd: {}, perTaskTypeUsd: {} };

  const costGate = new CostGate(pricingTable, ceilingConfig, new ReservationLedger(), DEV_TIER_MODEL_MAP);
  const approvalQueue = new ApprovalQueue(new AutonomyEngine(), new MockEffectExecutor());
  const ledger = new InMemoryTaskLedger();
  const router = new Router(ledger, new InMemoryDedupStore(), new MockExecutor(), costGate, approvalQueue);

  return { router, costGate, approvalQueue, ledger };
}
