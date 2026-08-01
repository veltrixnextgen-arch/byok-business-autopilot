# MVP-0 Differentiation Test — Report (v3, six fixtures + onboarding batch)

Run against the three canonical prompts from `docs/product/roles-and-api-key-guide.md` Part 2, plus three additional fixtures, per `docs/strategy/master-plan-v2.md` §5's MVP-0 kill criterion. This run exercises every engine change made since the v2 report: the **template-selection tiebreak fix**, the **physical-space membership template** (6th template, closes issue #2), **jurisdiction-aware compliance** (never guesses named regulations for an unverified jurisdiction), and the **onboarding batch** — the same per-signup run now also emits a simulated-day script and a Company Charter draft (closes issues #3 and #4).

## Per-signup cost — the real CAC number

**$0.0411 average per signup, $0.2468 total across all six fixtures**, well under the $0.25/run cap on every single run. Each signup is 2–3 API calls: `customize` (sonnet) + `category-validate` (haiku, skipped when there's nothing to validate) + `onboarding-batch` (haiku, switched from sonnet after a dedicated cost experiment — see [`haiku-batch-experiment.md`](haiku-batch-experiment.md), which also covers a real reliability bug the switch surfaced and fixed). This is comfortably inside master-plan-v2.md §3's $0.03–0.10/signup onboarding CAC target.

Raw org charts: [`candle-shop.json`](candle-shop.json) · [`freelance-bookkeeping.json`](freelance-bookkeeping.json) · [`mortgage-brokerage.json`](mortgage-brokerage.json) · [`makerspace.json`](makerspace.json) · [`saas-scheduler.json`](saas-scheduler.json) · [`wedding-photographer.json`](wedding-photographer.json). Run state (resumable): [`run-state.json`](run-state.json).

## Summary table

| | Candles | Bookkeeping | Mortgage (BC) | Makerspace (AU) | SaaS scheduler | Wedding photographer |
|---|---|---|---|---|---|---|
| Template | `ecommerce` (score 5, decisive) | `service` (score 3) | `service` (score 3) | **`physical-space`** (score 7, decisive) | `saas` (score 2.5) | `content` + blend `ecommerce` (**tie**, 1-1) |
| Jurisdiction | US/TX | US/OH | **CA/BC** | **Australia/Victoria** (uncovered) | US/DE | US/CA |
| Teams | 5 | 7 | 6 | 6 | 5 | 6 |
| Compliance tasks | 1 (generic) | 2 (generic + finance-adjacent) | **3** (generic + BCFSA + FINTRAC) | **2** (generic + AU-generic-fallback) | 1 (generic) | 2 (generic + CA-specific) |
| Per-signup cost | $0.0378 | $0.0408 | $0.0414 | $0.0375 | $0.0458 | $0.0435 |

**All 11 compliance tasks across all six charts carry `requiresProfessionalVerification: true`** — the hard invariant in `assembleOrgChart` never fired, meaning the customize pass complied with the rule on every run without needing a correction.

## Jurisdiction-aware compliance: the core fix, verified

This was the headline regression from the v2 report: the mortgage fixture had produced US-specific NMLS/RESPA/TILA tasks for a business whose country was never specified. With jurisdiction now a required interview field:

- **Mortgage brokerage, switched to Canada/British Columbia**, produces `BCFSA Licence Monitor` ("Flag any missing or expiring BCFSA mortgage broker licence documents and track renewal deadlines") and `FINTRAC / KYC File Checker` — real, correct BC/Canadian frameworks, not the old US ones.
- **Makerspace, deliberately set to Victoria, Australia** — a jurisdiction with zero coverage in the policy table — to prove the fallback path. It produces `Makerspace Regulatory Tracker`: "Identify and track local licensing and regulatory requirements ... in Victoria, Australia" — **no named regulation or regulator invented**, exactly what the fallback is supposed to do.

## Physical-space template: makerspace now selects decisively

The v2 report's makerspace fixture picked `ecommerce` over `local` on a 1-1 tie broken by object-key order — a real gap, tracked in issue #2. With the new `physical-space` template (memberships, bookings, facility ops, safety/waivers) and its keyword coverage:

**Makerspace now scores `physical-space: 7` vs. `ecommerce: 1` / `local: 1` — a decisive win, `tie: false`.** The resulting chart has an 8-sub-agent Ops team (booking scheduler, membership tracking, facility maintenance, vendor manager, event coordinator plus customize additions) and CFO correctly holds membership/rental billing as the business's own revenue — no `delivery` team needed, confirming the v2 finding that this business's paid work genuinely fits the existing back-office categories once there's a template that describes it.

One new tie surfaced this run: **wedding photographer, `content` vs. `ecommerce`, 1-1**, resolved by the new explicit `TIEBREAK_PRIORITY` (content ranks above ecommerce) rather than object-key order, and the `tie: true` flag is now visible in `meta.templateSelection` — a documented, surfaced ambiguity rather than a silent accident. This idea genuinely is a photography *service* wrapped around *digital products*, so a tie between those two template families is the honest answer.

## Onboarding batch

Every chart now carries a `simulatedDay` (3–5 illustrative completed-task cards with invented agent names, per userflow-v2 Stage 2) and a `charterDraft` (sharpened idea → MVP definition → every role's tasks → month-one goals → budget placeholder, per userflow-v2 Stage 4). Sample from the mortgage chart:

> Maya · Support Lead: Sent document checklists to 3 new first-time-buyer clients, confirmed 2 complete files, and flagged 1 client missing an employment letter — packaged for your review

Full haiku-vs-sonnet quality comparison, the truncation bug it surfaced, and the fix: [`haiku-batch-experiment.md`](haiku-batch-experiment.md).

## Checking the predicted outcomes (carried forward from v1/v2)

**Candles: lacks a Sales team, has heavy fulfillment.** ✅ Still confirmed — no `sales` team; Ops carries inventory/fulfillment.

**Bookkeeping: Delivery team present and substantial.** ✅ 5 sub-agents in Delivery this run (client-facing reconciliation-shaped work), CFO also at 5 — the delivery/cfo split continues to hold up run over run, though the exact size ranking varies by run depending on what customize judges necessary (same caveat as v2).

**Mortgage: compliance attaches, locked defaults, licensing tasks appear — jurisdiction-correct.** ✅ Confirmed, with jurisdiction verification above.

**SaaS: centers on Product/Dev.** ✅ Product/Dev is the largest team (5 sub-agents) with the only build/deploy machinery and `GitHub` Hands tool.

**Makerspace: physical-space fit.** ✅ Decisive template selection, rich facility-ops coverage (8 Ops sub-agents).

**Wedding photographer: hybrid product lines coexist.** ✅ CMO and CFO both carry distinct sub-agents per product line (photography vs. digital products) rather than collapsing them together.

## Known limitations

1. Delivery/CFO/Sales relative sizing for the bookkeeping-shaped businesses still varies run to run depending on customize's judgment calls — not a convergence problem, but not perfectly stable either.
2. The category validator occasionally proposes corrections that are debatable rather than clearly right — normal noise at this batch size, spot-check rather than trust blindly.
3. Template selection still has no keyword signal for genuinely novel business shapes beyond the six templates — expected, and the tie flag now surfaces it honestly rather than hiding it.

## Verdict: **PASS**

All six charts remain structurally distinct, and every fix from this round is independently verified against the actually-committed chart data: jurisdiction switch produces correct BC frameworks and a correct generic fallback for an uncovered jurisdiction, the physical-space template resolves what was previously a coin-flip into a decisive 7-vs-1 win, the tiebreak is explicit and surfaced rather than accidental, every compliance task carries its mandatory verification flag, and the onboarding batch produces coherent, company-specific content on every run — at $0.0411/signup average, inside the platform's own CAC target.
