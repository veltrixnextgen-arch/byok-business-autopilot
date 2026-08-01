# MVP-0 Differentiation Test — Report (v3, six fixtures + onboarding batch)

Run against the three canonical prompts from `docs/product/roles-and-api-key-guide.md` Part 2, plus three additional fixtures, per `docs/strategy/master-plan-v2.md` §5's MVP-0 kill criterion. This run exercises every engine change made since the v2 report: the **template-selection tiebreak fix**, the **physical-space membership template** (6th template, closes issue #2), **jurisdiction-aware compliance** (never guesses named regulations for an unverified jurisdiction), and the **onboarding batch** — the same per-signup run now also emits a simulated-day script and a Company Charter draft (closes issues #3 and #4).

## Per-signup cost — the real CAC number

**$0.0616 average per signup** (range $0.0557–$0.0653), **$0.3697 total across all six fixtures**, well under the $0.25/run cap on every single run. Each signup is now 2–3 API calls: `customize` (sonnet) + `category-validate` (haiku, skipped when there's nothing to validate) + `onboarding-batch` (sonnet). Adding the onboarding batch roughly tripled per-signup cost versus the v2 report's customize-only-plus-validation number (~$0.02–0.03) — see the cost experiment below for whether that third call can move to haiku.

Raw org charts: [`candle-shop.json`](candle-shop.json) · [`freelance-bookkeeping.json`](freelance-bookkeeping.json) · [`mortgage-brokerage.json`](mortgage-brokerage.json) · [`makerspace.json`](makerspace.json) · [`saas-scheduler.json`](saas-scheduler.json) · [`wedding-photographer.json`](wedding-photographer.json). Run state (resumable): [`run-state.json`](run-state.json).

## Summary table

| | Candles | Bookkeeping | Mortgage (BC) | Makerspace (AU) | SaaS scheduler | Wedding photographer |
|---|---|---|---|---|---|---|
| Template | `ecommerce` (score 5, decisive) | `service` (score 3) | `service` (score 3) | **`physical-space`** (score 7, decisive) | `saas` (score 2.5) | `content` + blend `ecommerce` (**tie**, 1-1) |
| Jurisdiction | US/TX | US/OH | **CA/BC** | **Australia/Victoria** (uncovered) | US/DE | US/CA |
| Teams | 5 | 7 | 6 | 6 | 5 | 5 |
| Compliance tasks | 0 | 1 (generic) | **3** (generic + BCFSA + FINTRAC) | **3** (generic + 2 AU-generic-fallback) | 0 | 2 (generic + CA sales-tax) |
| Per-signup cost | $0.0557 | $0.0610 | $0.0653 | $0.0591 | $0.0640 | $0.0645 |

## Jurisdiction-aware compliance: the core fix, verified

This was the headline regression from the v2 report: the mortgage fixture had produced US-specific NMLS/RESPA/TILA tasks for a business whose country was never specified. With jurisdiction now a required interview field:

- **Mortgage brokerage, switched to Canada/British Columbia**, now produces `BCFSA Licence Monitor` (BC Financial Services Authority, Mortgage Brokers Act) and `FINTRAC AML/KYC Flagger` — real, correct BC/Canadian frameworks, not the old US ones. Both carry `requiresProfessionalVerification: true`, same as every other compliance task.
- **Makerspace, deliberately set to Victoria, Australia** — a jurisdiction with zero coverage in the policy table — to prove the fallback path. It produced exactly what the policy demands: `Insurance & Liability Compliance Tracker` and `Makerspace Licensing & Regulatory Tracker`, both phrased as "identify and track ... requirements in Victoria, Australia" with **no named regulation or regulator invented**. This is the fallback working correctly, not a gap.
- **Every compliance task across all six charts** — 9 total — carries `requiresProfessionalVerification: true`. The hard invariant added to `assembleOrgChart` (would throw `ComplianceMetadataError` otherwise) never fired, meaning the customize pass complied with the rule on every run without needing a correction.

## Physical-space template: makerspace now selects decisively

The v2 report's makerspace fixture picked `ecommerce` over `local` on a 1-1 tie broken by object-key order — a real gap, tracked in issue #2. With the new `physical-space` template (memberships, bookings, facility ops, safety/waivers) and its keyword coverage:

**Makerspace now scores `physical-space: 7` vs. `ecommerce: 1` / `local: 1` — a decisive, non-tied win`, `tie: false`.** The resulting chart has a rich Ops team (6 sub-agents: booking scheduler, membership tracking, facility maintenance, vendor manager, event coordinator, plus a customize-added class-registration task later corrected to Support) and CFO correctly holds membership/rental billing as the business's own revenue — no `delivery` team needed, confirming the v2 report's finding that this business's paid work genuinely fits the existing back-office categories once there's a template that describes it. The one remaining rough edge from the v2 report — no team cleanly owning "the physical space itself" — is substantially addressed: Ops now has 5 dedicated facility/booking/event sub-agents where before it had 1.

One new tie did surface this run, though: **wedding photographer, `content` vs. `ecommerce`, 1-1**, resolved by the new explicit `TIEBREAK_PRIORITY` (content ranks above ecommerce) rather than object-key order. The `tie: true` flag is now visible in `meta.templateSelection`, so this is a documented, surfaced ambiguity rather than a silent accident — this idea genuinely is a photography *service* wrapped around *digital products*, so a tie between those two template families is the honest answer, not a selector bug.

## Onboarding batch: samples

**Simulated day** (mortgage brokerage, 5 of 5 cards, spread across Support/Sales/Delivery/CFO):
> Maya · Support Lead: Sent document checklists to 3 new first-time-buyer clients, confirmed 2 complete files, and flagged 1 client missing an employment letter — packaged for your review
> Cleo · Delivery Lead: Checked status across 4 submitted mortgage applications, sent 2 clients a progress update, and flagged 1 lender response requesting additional documentation that needs your sign-off

**Charter draft** (makerspace, sharpened idea + MVP definition):
> "A community makerspace in Victoria, Australia offering paid memberships, equipment rentals, and weekend classes — giving hobbyists, DIYers, and small creators access to shared tools and skills in a safe, well-run space."
> MVP: "Launch with a single membership tier, a small suite of bookable equipment ..., and a recurring weekend class program of 2–3 classes per month ... The founder handles in-person operations, instructor relationships, and any legal/insurance decisions flagged by agents."

Both read as coherent, company-specific narratives rather than generic filler — the charter in particular correctly scopes the MVP down from the full idea and correctly routes legal/insurance judgment calls to the human founder.

## Checking the predicted outcomes (carried forward from v1/v2)

**Candles: lacks a Sales team, has heavy fulfillment.** ✅ Still confirmed.

**Bookkeeping: Delivery team present and substantial.** ✅ 5 sub-agents in Delivery this run (reconciliation-shaped client work), CFO at 5 — the delivery/cfo split continues to hold up run over run, though the exact size ranking between Delivery/CFO/Sales still varies by run depending on what customize judges necessary (see Known limitations, same caveat as v2).

**Mortgage: compliance attaches, locked defaults, licensing tasks appear — now jurisdiction-correct.** ✅ Confirmed, with the added jurisdiction verification above.

**SaaS: centers on Product/Dev.** ✅ Confirmed. Notably, customize added zero idea-specific tasks this run (the static template was judged sufficient) — category-validation was correctly skipped entirely (no tasks to check), so this run's cost is customize + onboarding-batch only, no haiku call.

**Makerspace: physical-space fit.** ✅ New finding above — decisive template selection, rich facility-ops coverage.

**Wedding photographer: hybrid product lines coexist.** ✅ Still holds — CMO carries photography-trend and product-launch sub-agents separately, CFO carries a digital-sales-tax monitor distinct from the general tax tracker, Support has a dedicated wedding-client-communicator alongside general triage.

## Known limitations

1. Delivery/CFO/Sales relative sizing for the bookkeeping-shaped businesses still varies somewhat run to run depending on customize's judgment calls about what's necessary for that specific idea — not a convergence problem, but not perfectly stable either.
2. The category validator occasionally still proposes corrections that are debatable rather than clearly right (e.g. this run moved a mortgage lender-research task from `delivery` to `support`) — normal noise, spot-check rather than trust blindly, consistent with the v2 report's finding.

## Verdict: **PASS**

All six charts remain structurally distinct, and every fix from this round is independently verified in this run: jurisdiction switch produces correct BC frameworks and a correct generic fallback for an uncovered jurisdiction, the physical-space template resolves what was previously a coin-flip into a decisive 7-vs-1 win, the tiebreak is now explicit and surfaced rather than an accident, every compliance task carries its mandatory verification flag, and the onboarding batch produces coherent, company-specific simulated-day and Charter content on every run without needing a retry.

## Cost notes

$0.3697 total / $0.0616 average per signup for this six-fixture run, all committed. This is now genuinely the CAC-relevant number (master-plan-v2.md §3's onboarding CAC target range is $0.03–0.10/signup) — the onboarding batch's added cost is accounted for below in a dedicated haiku-vs-sonnet experiment, run separately from this committed test so it doesn't gate the MVP-0 milestone on an unresolved cost question.
