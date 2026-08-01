// Cost guard for the customize pass. Mirrors the platform's own capped-
// onboarding principle (master-plan-v2.md §0, §3: onboarding CAC is a
// capped batch of cents per signup) — this engine must never spend more
// than a hard ceiling on a single extraction run.

// USD per million tokens. Sonnet-class pricing as of this writing; update
// from the current Anthropic pricing page if it changes.
export const PRICING = {
  inputPerMTok: 3.0,
  outputPerMTok: 15.0,
};

export const DEFAULT_MAX_COST_USD = 0.25;

// Rough token estimate (~4 chars/token) used only for the pre-flight guard,
// before we have real usage numbers back from the API.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCostUsd(inputTokens: number, maxOutputTokens: number): number {
  return (inputTokens / 1_000_000) * PRICING.inputPerMTok + (maxOutputTokens / 1_000_000) * PRICING.outputPerMTok;
}

export function actualCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * PRICING.inputPerMTok + (outputTokens / 1_000_000) * PRICING.outputPerMTok;
}

export class CostGuardError extends Error {}

export function guardEstimatedCost(promptText: string, maxOutputTokens: number, maxCostUsd: number): number {
  const inputTokens = estimateTokens(promptText);
  const estimated = estimateCostUsd(inputTokens, maxOutputTokens);
  if (estimated > maxCostUsd) {
    throw new CostGuardError(
      `Aborting: estimated cost $${estimated.toFixed(4)} exceeds the $${maxCostUsd.toFixed(2)} cap ` +
        `(≈${inputTokens} input tokens + up to ${maxOutputTokens} output tokens).`,
    );
  }
  return estimated;
}
