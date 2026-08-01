import type { Tier } from "./pricing.js";

// deployment-safety-and-cost-routing.md Part 2, lever #2: "Default to Tier
// 1. Escalate to Tier 2/3 only when a confidence check fails, the model
// flags uncertainty, or the task is explicitly marked high-stakes — never
// escalate by default just because a 'better' model exists."
export interface TierRoutingInput {
  stakes: "low" | "medium" | "high";
  /** True when a prior attempt's confidence/consensus check failed, or the
   *  model itself flagged uncertainty — the ONLY non-stakes escalation
   *  trigger this router recognizes. */
  failedValidation?: boolean;
}

const BASE_TIER_BY_STAKES: Record<TierRoutingInput["stakes"], Tier> = {
  low: "T1",
  medium: "T1",
  high: "T3", // explicit high-stakes goes straight to frontier, no default drift
};

const ESCALATE_ONE_TIER: Record<Tier, Tier> = { T1: "T2", T2: "T3", T3: "T3" };
const DOWNGRADE_ONE_TIER: Record<Tier, Tier | null> = { T3: "T2", T2: "T1", T1: null };

export function routeTier(input: TierRoutingInput): Tier {
  const base = BASE_TIER_BY_STAKES[input.stakes];
  return input.failedValidation ? ESCALATE_ONE_TIER[base] : base;
}

export function tierOneStepDown(tier: Tier): Tier | null {
  return DOWNGRADE_ONE_TIER[tier];
}

export interface TierModelMap {
  T1: string;
  T2: string;
  T3: string;
}

export function selectModel(tier: Tier, modelMap: TierModelMap): string {
  return modelMap[tier];
}
