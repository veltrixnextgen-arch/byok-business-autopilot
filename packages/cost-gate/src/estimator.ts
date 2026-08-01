import type { PricingTable } from "./pricing.js";

// Expected shape of the response — a coarse signal, but a meaningful one:
// output tokens cost ~5x input (deployment-safety-and-cost-routing.md
// Part 3, lever #4), so how verbose the expected response is dominates the
// estimate's uncertainty far more than the input side does.
export type OutputClass = "short-structured" | "prose";

interface OutputHeuristic {
  baseTokens: number;
  marginRatio: number;
}

const OUTPUT_HEURISTICS: Record<OutputClass, OutputHeuristic> = {
  "short-structured": { baseTokens: 300, marginRatio: 0.2 },
  prose: { baseTokens: 1200, marginRatio: 0.4 },
};

// ~4 chars/token, the same rough heuristic used elsewhere in this codebase
// (packages/agents/extraction/src/costGuard.ts) for pre-flight estimates.
function estimateInputTokens(payload: string): number {
  return Math.ceil(payload.length / 4);
}

export interface CostEstimate {
  model: string;
  inputTokensEstimate: number;
  outputTokensEstimate: number;
  /** Uncertainty margin as a ratio, e.g. 0.2 = ±20%. */
  marginRatio: number;
  costLowerBoundUsd: number;
  costUpperBoundUsd: number;
}

// Throws whatever pricingTable.priceFor() throws (UnknownModelError,
// StalePricingTableError) — this function makes NO attempt to recover or
// fall back to a guessed price. The gate is the only thing that decides
// what to do about an estimation failure, and per spec, that's always
// QUEUE, never a best-effort PROCEED.
export function estimateCost(payload: string, model: string, outputClass: OutputClass, pricingTable: PricingTable): CostEstimate {
  const price = pricingTable.priceFor(model);
  const inputTokensEstimate = estimateInputTokens(payload);
  const { baseTokens, marginRatio } = OUTPUT_HEURISTICS[outputClass];
  const outputTokensEstimate = baseTokens;

  const baseCost =
    (inputTokensEstimate / 1_000_000) * price.inputPerMTok + (outputTokensEstimate / 1_000_000) * price.outputPerMTok;

  return {
    model,
    inputTokensEstimate,
    outputTokensEstimate,
    marginRatio,
    costLowerBoundUsd: baseCost * (1 - marginRatio),
    // Gate decisions use this bound (spec: "use the margin's UPPER bound
    // for gate decisions") — never the point estimate, never the lower
    // bound. Erring toward "this might cost more than it looks" is the
    // fail-closed choice here.
    costUpperBoundUsd: baseCost * (1 + marginRatio),
  };
}
