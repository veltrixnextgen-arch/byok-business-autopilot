import { ApprovalQueue, AutonomyEngine, MockEffectExecutor } from "@byok/approval-queue";
import { CostGate, PricingTable, ReservationLedger, type TierModelMap } from "@byok/cost-gate";
import { InMemoryDedupStore, InMemoryTaskLedger, MockExecutor, Router } from "@byok/router";
import type { TrustCoreDeps } from "../context.js";

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
  const modelMap: TierModelMap = {
    T1: "claude-haiku-4-5",
    T2: "claude-sonnet-4-6",
    T3: "claude-opus-4-6",
  };

  const pricingTable = new PricingTable({
    version: 1,
    lastVerified: new Date().toISOString().slice(0, 10),
    prices: {
      "claude-haiku-4-5": { provider: "anthropic", tier: "T1", inputPerMTok: 0.8, outputPerMTok: 4 },
      "claude-sonnet-4-6": { provider: "anthropic", tier: "T2", inputPerMTok: 3, outputPerMTok: 15 },
      "claude-opus-4-6": { provider: "anthropic", tier: "T3", inputPerMTok: 15, outputPerMTok: 75 },
    },
  });

  const ceilingConfig = { companyMonthlyUsd: 50, perRoleUsd: {}, perTaskTypeUsd: {} };

  const costGate = new CostGate(pricingTable, ceilingConfig, new ReservationLedger(), modelMap);
  const approvalQueue = new ApprovalQueue(new AutonomyEngine(), new MockEffectExecutor());
  const router = new Router(
    new InMemoryTaskLedger(),
    new InMemoryDedupStore(),
    new MockExecutor(),
    costGate,
    approvalQueue,
  );

  return { router, costGate, approvalQueue };
}
