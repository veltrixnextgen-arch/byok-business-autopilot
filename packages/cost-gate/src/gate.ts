import { estimateCost, type CostEstimate, type OutputClass } from "./estimator.js";
import { checkCeilings, type CeilingConfig } from "./ceilings.js";
import type { ReservationLedger } from "./reservations.js";
import type { PricingTable } from "./pricing.js";
import { selectModel, tierOneStepDown, type TierModelMap } from "./tierRouter.js";

// security-architecture.md §6 / T4: "the fail-closed pre-call gate
// (estimate → over-ceiling means downgrade/queue/skip; estimator down
// means QUEUE)." This function is PURE — no I/O, no mutation, no side
// effects — so it can be property-tested exhaustively: for any input where
// any step could error, the only possible outputs are QUEUE or SKIP, never
// PROCEED. The CostGate class (costGate.ts) is what actually reserves
// budget and logs; this function only decides.
export type GateVerdictKind = "PROCEED" | "DOWNGRADE" | "QUEUE" | "SKIP";

export interface GateVerdict {
  kind: GateVerdictKind;
  reason: string;
  /** The model to actually use for PROCEED/DOWNGRADE. Echoes the
   *  originally-requested model for QUEUE/SKIP (nothing runs). */
  model: string;
  estimate?: CostEstimate;
}

export interface GateEvaluationInput {
  taskId: string;
  roleId: string;
  taskType: string;
  payload: string;
  model: string;
  outputClass: OutputClass;
  /** Whether this task type tolerates being queued for later/batch
   *  processing. Non-batchable + over-ceiling goes straight to SKIP. */
  batchable: boolean;
}

// Multi-provider AI (Phase 2 item 5, ADR-048): one TierModelMap per
// provider, not one map shared across all of them — a T2 downgrade for an
// OpenAI-keyed task must land on an OpenAI model, never silently jump to
// a cheaper ANTHROPIC model just because it happened to be in the same
// map. Keyed by the same provider string PricingEntry.provider already
// carries (see pricing.ts) — never a subset union, since new providers
// are pure data additions to pricing-table.json, not a type change here.
export type TierModelMapsByProvider = Record<string, TierModelMap>;

export interface GateDependencies {
  pricingTable: PricingTable;
  ceilingConfig: CeilingConfig;
  ledger: ReservationLedger;
  modelMaps: TierModelMapsByProvider;
}

export function evaluateGateVerdict(input: GateEvaluationInput, deps: GateDependencies): GateVerdict {
  // Step 1: estimate at the requested model. ANY failure here — unknown
  // model, stale pricing table — fails closed to QUEUE. Never PROCEED on
  // an estimate we don't trust.
  let estimate: CostEstimate;
  try {
    estimate = estimateCost(input.payload, input.model, input.outputClass, deps.pricingTable);
  } catch (err) {
    return { kind: "QUEUE", reason: `Estimator error, failing closed: ${(err as Error).message}`, model: input.model };
  }

  // Step 2: ceilings, company -> role -> task-type, against the upper bound.
  const check = checkCeilings(estimate.costUpperBoundUsd, input, deps.ceilingConfig, deps.ledger);
  if (check.withinCeiling) {
    return { kind: "PROCEED", reason: "Within all ceilings.", model: input.model, estimate };
  }

  // Step 3: try exactly one tier down before giving up on executing now.
  const downgraded = tryDowngrade(input, deps);
  if (downgraded) return downgraded;

  // Step 4: queue for batch, if this task type tolerates the delay.
  if (input.batchable) {
    return {
      kind: "QUEUE",
      reason: `Over ${check.exceededLevel} ceiling even after downgrade attempt; queued for batch.`,
      model: input.model,
      estimate,
    };
  }

  // Step 5: nothing left — skip and let the caller notify the user.
  return {
    kind: "SKIP",
    reason: `Over ${check.exceededLevel} ceiling, downgrade insufficient, and this task type isn't batchable.`,
    model: input.model,
    estimate,
  };
}

function tryDowngrade(input: GateEvaluationInput, deps: GateDependencies): GateVerdict | null {
  let currentEntry;
  try {
    currentEntry = deps.pricingTable.priceFor(input.model);
  } catch {
    return null; // can't even determine current tier — no safe downgrade path
  }

  const lowerTier = tierOneStepDown(currentEntry.tier);
  if (!lowerTier) return null; // already cheapest tier, nowhere to downgrade to

  // Same provider as the requested model, always — the vault key already
  // decrypted for this task's role belongs to ONE provider; a downgrade
  // that silently switched providers would need a different Brain key the
  // executor was never given.
  const modelMap = deps.modelMaps[currentEntry.provider];
  if (!modelMap) return null; // no tier map configured for this provider — no safe downgrade path

  const downgradedModel = selectModel(lowerTier, modelMap);

  let downgradedEstimate: CostEstimate;
  try {
    downgradedEstimate = estimateCost(input.payload, downgradedModel, input.outputClass, deps.pricingTable);
  } catch {
    return null; // downgraded model itself unpriceable/stale — do not proceed on a guess
  }

  const downgradedCheck = checkCeilings(downgradedEstimate.costUpperBoundUsd, input, deps.ceilingConfig, deps.ledger);
  if (!downgradedCheck.withinCeiling) return null;

  return {
    kind: "DOWNGRADE",
    reason: `Over ceiling at ${input.model}; downgraded to ${downgradedModel} fits.`,
    model: downgradedModel,
    estimate: downgradedEstimate,
  };
}
