// Cost guard for every API call the pipeline makes (customize pass +
// category validation pass). Mirrors the platform's own capped-onboarding
// principle (master-plan-v2.md §0, §3: onboarding CAC is a capped batch of
// cents per signup) — this engine must never spend more than a hard ceiling
// on a single extraction run, across ALL calls in that run combined.

// USD per million tokens, per model. Current as of this writing — update
// from the Anthropic pricing page if it changes.
export const PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "claude-sonnet-4-6": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 0.8, outputPerMTok: 4.0 },
};

export const DEFAULT_MAX_COST_USD = 0.25;

function pricingFor(model: string) {
  const pricing = PRICING[model];
  if (!pricing) throw new Error(`No pricing entry for model "${model}" — add one to costGuard.ts PRICING.`);
  return pricing;
}

// Rough token estimate (~4 chars/token) used only for the pre-flight guard,
// before we have real usage numbers back from the API.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCostUsd(model: string, inputTokens: number, maxOutputTokens: number): number {
  const pricing = pricingFor(model);
  return (inputTokens / 1_000_000) * pricing.inputPerMTok + (maxOutputTokens / 1_000_000) * pricing.outputPerMTok;
}

export function actualCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = pricingFor(model);
  return (inputTokens / 1_000_000) * pricing.inputPerMTok + (outputTokens / 1_000_000) * pricing.outputPerMTok;
}

export class CostGuardError extends Error {}

export function guardEstimatedCost(model: string, promptText: string, maxOutputTokens: number, maxCostUsd: number): number {
  const inputTokens = estimateTokens(promptText);
  const estimated = estimateCostUsd(model, inputTokens, maxOutputTokens);
  if (estimated > maxCostUsd) {
    throw new CostGuardError(
      `Aborting: estimated cost $${estimated.toFixed(4)} exceeds the $${maxCostUsd.toFixed(2)} cap ` +
        `(≈${inputTokens} input tokens + up to ${maxOutputTokens} output tokens, model ${model}).`,
    );
  }
  return estimated;
}
