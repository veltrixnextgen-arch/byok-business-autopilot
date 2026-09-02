import type { Tier } from "@byok/templates";
import type { BrainRecommendation } from "@byok/contracts";

/**
 * North star doc Tier 1 item 1: BrainRecommendation.reason must be honest,
 * not invented — its own doc comment (@byok/contracts's orgChart.ts) is
 * explicit that "which provider, and why" is a real product decision
 * nobody has made. No per-provider capability benchmark (coding quality,
 * writing quality, etc.) exists anywhere in this codebase to draw such a
 * claim from, so this makes the one claim that IS real and checkable: cost.
 *
 * Snapshot of packages/cost-gate/src/pricing-table.json (lastVerified
 * 2026-08-27) — duplicated here rather than imported so this package
 * doesn't pick up a dependency on @byok/cost-gate for one lookup table
 * (same reasoning TIER_DEFAULT_BUDGET_PER_DAY_USD, @byok/contracts, already
 * gives for its own hardcoded snapshot). Recommendation is the cheapest
 * provider at each tier by summed $/Mtok (input + output):
 *   T1: gpt-5-nano $0.05/$0.40 vs Gemini 2.5 Flash-Lite $0.10/$0.40 vs
 *       Claude Haiku 4.5 $0.80/$4.00 -> openai wins outright.
 *   T2: Gemini 2.5 Pro and GPT-5 tie at $1.25/$10, both roughly half
 *       Claude Sonnet 4.6's $3/$15 -> google picked as the tie-break.
 *   T3: Claude Opus 4.6 $15/$75 vs GPT-5 Pro $15/$120 -> anthropic wins.
 * If pricing-table.json changes, update this snapshot to match — a stale
 * recommendation here is a bug, not a style nit.
 */
const BRAIN_RECOMMENDATION_BY_TIER: Record<Tier, BrainRecommendation> = {
  T1: {
    provider: "openai",
    reason:
      "gpt-5-nano runs $0.05 / $0.40 per million input/output tokens — the cheapest option at this tier by a wide margin, well suited to this agent's high-volume, low-stakes work.",
  },
  T2: {
    provider: "google",
    reason:
      "Gemini 2.5 Pro runs $1.25 / $10 per million input/output tokens, tied with GPT-5 and roughly half the cost of Claude Sonnet 4.6 ($3 / $15) — a strong balance of quality and cost for this agent's day-to-day drafting and reasoning work.",
  },
  T3: {
    provider: "anthropic",
    reason:
      "Claude Opus 4.6 runs $15 / $75 per million input/output tokens, cheaper than GPT-5 Pro ($15 / $120) at the same frontier tier — the better value for this agent's high-stakes strategic work.",
  },
};

export function recommendBrain(tier: Tier): BrainRecommendation {
  return BRAIN_RECOMMENDATION_BY_TIER[tier];
}
