# Cost experiment: haiku for the onboarding batch

Separate from the committed MVP-0 differentiation test — this doesn't gate that milestone. Question: the onboarding batch (simulated-day script + Charter draft) is formatting/synthesis over an already-extracted org chart, not fresh reasoning. Does it hold up on `claude-haiku-4-5` instead of `claude-sonnet-4-6`?

## Method

Reused two already-assembled charts (no re-spend on customize/category-validate) — `mortgage-brokerage` (complex, compliance-heavy, largest chart) and `candle-shop` (simple) — and ran `generateOnboardingBatch` on both models for both. Outputs saved to `test/results/experiments/`.

## Round 1: cost delta, and one real quality issue

| Fixture | Sonnet | Haiku | Delta |
|---|---|---|---|
| mortgage-brokerage | $0.0308–0.0333 | $0.0075–0.0082 | ~4x cheaper |
| candle-shop | $0.0273–0.0278 | $0.0077–0.0081 | ~4x cheaper |

Reading both versions side by side: substance, specificity, and narrative coherence were comparable — haiku's outputs were not generic filler, correctly referenced jurisdiction-specific detail (BCFSA/FINTRAC for the BC mortgage fixture, Texas sales-tax for the candle fixture), and in a few spots were *more* quantified than sonnet's (e.g. "3–5 first-time homebuyers per month," "25–30 initial orders").

**One real issue found:** haiku consistently prefixed Charter role-tasks with the sub-agent's category label ("Invoicing: Create invoices...", "Trend researcher: Monitor trending...") instead of natural prose. Sonnet never did this. It's a real violation of the product's plain-language design law (`docs/product/roles-and-api-key-guide.md` Part 1: "never jargon"), not noise — present in both haiku samples, absent from both sonnet samples.

**Fix:** added one explicit rule to the prompt banning label-prefixing, with a concrete before/after example. Reran the candle-shop haiku case — the prefix pattern was gone, output read as natural prose, and quality was otherwise unchanged. Kept the fix (it's model-agnostic — sonnet's output was unaffected by it).

## Round 2: a second, more serious issue — and its fix

Switched the default model to haiku and ran the full six-fixture suite once to confirm, per plan. **2 of 6 fixtures (candle-shop, saas-scheduler) failed to produce an onboarding batch at all** — the tool call came back missing `charterDraft`. This is a more serious failure mode than the style tic: a silent, total loss of the deliverable (the pipeline degrades gracefully — the org chart itself is unaffected, `onboardingBatch` is just `null` — but the user gets nothing for that call).

Diagnosis: added `stop_reason`/token-usage logging and checked `MAX_OUTPUT_TOKENS` (was 1800). Haiku tends to be more verbose than sonnet for the same content, and the tool schema puts `simulatedDay` before `charterDraft` — on the two larger charts (most tasks/sub-agents), haiku's `simulatedDay` output alone was apparently consuming enough of the 1800-token budget that `charterDraft` got truncated mid-generation and dropped from the parsed tool input.

**Fix:** raised `MAX_OUTPUT_TOKENS` to 3000. Regenerated the onboarding batch for both previously-failing fixtures (reusing their already-assembled charts, no re-spend on customize/validate) — both succeeded cleanly on the first retry, confirming the token cap was the actual cause, not a haiku capability limit.

## Decision: switch to haiku, with both fixes applied

Both issues were real but shallow — prompt-level, not model-capability-level — and both are now fixed in `packages/agents/extraction/src/onboardingBatch.ts`. Final full-suite numbers, haiku + both fixes, all six onboarding batches present:

| Fixture | Total cost | Onboarding-batch cost |
|---|---|---|
| candle-shop | $0.0378 | $0.0081 |
| freelance-bookkeeping | $0.0408 | ~$0.008 |
| makerspace | $0.0375 | ~$0.008 |
| mortgage-brokerage | $0.0414 | ~$0.008 |
| saas-scheduler | $0.0458 | $0.0116 |
| wedding-photographer | $0.0435 | ~$0.009 |

**New total: $0.2468 across six signups. New average: $0.0411/signup** (down from $0.0616/signup with sonnet — a ~33% reduction in the real per-signup CAC, master-plan-v2.md §3's target range of $0.03–0.10/signup).

## What this doesn't cover

This experiment used 2 fixtures for the initial quality read and confirmed via a full 6-fixture rerun — it is not an exhaustive quality audit. The truncation failure mode (round 2) is the kind of thing that could plausibly recur on an even larger/more complex chart than any of these six; `MAX_OUTPUT_TOKENS = 3000` is a bigger margin than what any current fixture needed, not a proven ceiling. Worth revisiting if a future business idea produces a meaningfully larger org chart than these.
