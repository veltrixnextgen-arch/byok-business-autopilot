# MVP-0 Differentiation Test — Report (v4, Step 5 interview schema)

Rerun after Phase B Step 5's interview redesign: the old 6-question `businessType/whoPays/channels/status/dread/budget` schema is gone, replaced by ADR-011's 5-question universal value-chain spine (`whatCustomersPayFor`, `whoTheCustomerIs`, `howMoneyArrives`, `howDeliveryReaches`, `jurisdiction`), up to 3 template-declared branch questions per business type, and 2 context questions (`stage`, `whoIsWorkingOnIt`). All six fixtures were rewritten to the new `InterviewAnswers` shape (including real `branchAnswers` for their selected template) and rerun for real — this is not a re-derivation of the v3 report, every number below came from a live `--fresh` run against the actual API.

## A real bug this run caught

The rerun surfaced a genuine correctness bug in `Agent.complianceLocked` (added in Step 4, ADR-013): it was derived from `autonomyDefault === "locked"`, but plenty of tasks are locked for caution unrelated to compliance (a `tax-deadline-tracker` agent came back `complianceLocked: true` with `requiresProfessionalVerification: false` — exactly backwards). Fixed in `assemble.ts` to derive `complianceLocked` from `requiresProfessionalVerification` directly (the two are meant to be the same fact, not independently-derived ones). Reran fresh after the fix; **zero mismatches between `complianceLocked` and `requiresProfessionalVerification` across all 118 agents in all six charts.**

## Per-signup cost — the real CAC number

**$0.0407 average per signup, $0.2442 total across all six fixtures**, comfortably inside master-plan-v2.md §3's $0.03–0.10/signup onboarding CAC target and the $0.25/run cap. Same 2–3 API calls per signup as v3 (customize/sonnet → category-validate/haiku → onboarding-batch/haiku) — the new interview schema didn't change the cost shape, only its inputs.

Raw org charts: [`candle-shop.json`](candle-shop.json) · [`freelance-bookkeeping.json`](freelance-bookkeeping.json) · [`mortgage-brokerage.json`](mortgage-brokerage.json) · [`makerspace.json`](makerspace.json) · [`saas-scheduler.json`](saas-scheduler.json) · [`wedding-photographer.json`](wedding-photographer.json). Run state (resumable): [`run-state.json`](run-state.json).

## Summary table

| | Candles | Bookkeeping | Mortgage (BC) | Makerspace (AU) | SaaS scheduler | Wedding photographer |
|---|---|---|---|---|---|---|
| Template | `ecommerce` (score 4, decisive) | `service` (score 4, decisive) | `service` (score 5, decisive) | **`physical-space`** (score 7, decisive) | `saas` (score 2.5, decisive) | `content` + blend `physical-space` (**4-way tie**, 1-1-1-1) |
| Branch answers used | inventoryModel: own-inventory, sellsThrough: marketplace | billingModel: retainer, deliveryMode: remote | billingModel: per-project, deliveryMode: mixed | safetyRisk: safety-risk, classesOrSelfServe: both | buildStage: idea-only, needsWaitlist: yes | primaryFormat: mixed, brandDealsNow: no |
| Jurisdiction | US/TX | US/OH | **CA/BC** | **Australia/Victoria** (uncovered) | US/DE | US/CA |
| Teams / Agents / Tasks | 5 / 18 / 21 | 7 / 20 / 25 | 6 / 16 / 24 | 6 / 23 / 23 | 6 / 15 / 19 | 8 / 26 / 29 |
| Compliance agents | Sales Tax Compliance Monitor, Product Safety Compliance Monitor | Compliance sub-agent | Compliance sub-agent | Safety & waivers, Licensing & Regulatory Tracker, WHS Compliance Tracker | Platform Policy Monitor | Safety & waivers (see note below), Digital Sales Tax Compliance Flagger |
| Per-signup cost | $0.0379 | $0.0432 | $0.0442 | $0.0372 | $0.0390 | $0.0426 |

**All compliance agents across all six charts carry `requiresProfessionalVerification: true` AND `complianceLocked: true`, with zero exceptions among the other ~107 agents** — the fix above holds up across every fixture, not just the one that originally caught it.

## The branch-question mechanism, exercised for real

Every fixture's `branchAnswers` (table above) came from the same template-declared `branchQuestions` apps/web renders — `getInterviewQuestionsForTemplate` in `packages/agents/extraction`, fed into `customize.ts`'s prompt as plain-language context lines. This is the first real (non-mocked) exercise of that mechanism since Step 5 built it: template selection on partial (spine-only) answers correctly identified the right template for all six ideas before any branch question was asked, and the branch answers visibly shaped the resulting charts (e.g. candle shop's `inventoryModel: own-inventory` kept inventory/reorder tasks in the chart; a `dropship-or-pod` answer would plausibly have dropped them, though that's not directly tested here — an opportunity for a future fixture).

## Wedding photographer: the tie shape changed, not the outcome

v3's wedding-photographer fixture tied `content` vs. `ecommerce` 1-1. This run it's a 4-way tie (`content`/`ecommerce`/`local`/`physical-space`, all at 1) — a direct, expected consequence of the new `howDeliveryReaches` spine question replacing the old `channels` field: `howDeliveryReaches: "in-person"` now awards templateSelect.ts's keyword-adjacent bonus to **both** `local` and `physical-space` (previously only `local` got it from `channels: "local"`). The same explicit `TIEBREAK_PRIORITY` still resolves it to `content` primary, but the blend partner shifted from `ecommerce` to `physical-space` — which pulled `physical-space`'s `compliance.safety-waivers` task into the customize pass's base task set. The result: a "Safety & waivers" compliance agent on a wedding-photography chart, which reads oddly for the business (no real safety-waiver concern for a photographer) but isn't wrong per the mechanism — it's an honest, visible consequence of template blending on a genuinely ambiguous idea, not a silent error. Logged under Known limitations below rather than special-cased away.

## Checking the predicted outcomes (carried forward from v1-v3)

**Candles: lacks a Sales team, has heavy fulfillment.** ✅ Still confirmed.

**Bookkeeping: Delivery team present and substantial.** ✅ Confirmed this run too.

**Mortgage: compliance attaches, locked defaults, licensing tasks appear — jurisdiction-correct.** ✅ Confirmed; BC-specific compliance agent present, correctly `complianceLocked: true`.

**SaaS: centers on Product/Dev.** ✅ Confirmed.

**Makerspace: physical-space fit.** ✅ Decisive template selection (score 7), rich facility-ops coverage, three distinct compliance agents (safety/waivers, licensing, and — new this run — a WHS-specific tracker, Australia's workplace-health-and-safety framework).

**Wedding photographer: hybrid product lines coexist.** ✅ CMO/CFO still carry distinct sub-agents per product line; see the tie-shape note above for the one new wrinkle.

## Known limitations

1. Template blending can pull an unrelated compliance task into a chart when the tied second-place template contributes one the primary template wouldn't have needed on its own (wedding photographer's "Safety & waivers", this run) — visible and traceable in `meta.templateSelection`, not silently wrong, but not filtered out either.
2. Delivery/CFO/Sales relative sizing for the bookkeeping-shaped businesses still varies run to run depending on customize's judgment calls.
3. The category validator occasionally proposes corrections that are debatable rather than clearly right — normal noise at this batch size.
4. Template selection still has no keyword signal for genuinely novel business shapes beyond the six templates.

## Verdict: **PASS**

All six charts remain structurally distinct under the new interview schema, the real `complianceLocked` bug this run caught is fixed and verified with zero mismatches across every agent in every chart, the branch-question mechanism is exercised for real (not just typechecked) and visibly shapes chart content, jurisdiction handling is unchanged and correct, and the average per-signup cost ($0.0407) stays inside the platform's own CAC target.
