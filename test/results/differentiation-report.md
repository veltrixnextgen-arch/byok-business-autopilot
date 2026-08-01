# MVP-0 Differentiation Test — Report (v2, six fixtures)

Run against the three canonical prompts from `docs/product/roles-and-api-key-guide.md` Part 2, plus three additional fixtures chosen to stress-test the delivery-team concept, the compliance path, and template blending, per `docs/strategy/master-plan-v2.md` §5's MVP-0 kill criterion. This run also exercises two engine changes made since the v1 report: the **delivery-team concept** (paid-deliverable tasks cluster separately from back-office CFO tasks, with Hands-scope isolation enforced as a hard invariant) and a **category-tagging validation pass** (a cheap batched haiku-class call that re-checks every customize-added task's category).

Raw org charts: [`candle-shop.json`](candle-shop.json) · [`freelance-bookkeeping.json`](freelance-bookkeeping.json) · [`mortgage-brokerage.json`](mortgage-brokerage.json) · [`makerspace.json`](makerspace.json) · [`saas-scheduler.json`](saas-scheduler.json) · [`wedding-photographer.json`](wedding-photographer.json). Customize model: `claude-sonnet-4-6`. Validation model: `claude-haiku-4-5-20251001`. **Total API cost: $0.1964** (6 runs, all under the $0.25/run cap; see cost notes at the end).

## Summary table

| | Candles (ecommerce) | Bookkeeping (service) | Mortgage brokerage (service) | Makerspace (ecommerce+local blend) | SaaS scheduler (saas) | Wedding photographer (ecommerce+content blend) |
|---|---|---|---|---|---|---|
| Template | `ecommerce` | `service` | `service` | `ecommerce` + blend `local` | `saas` | `ecommerce` + blend `content` |
| Teams | founder, cfo, cmo, ops, support, **delivery** | founder, cfo, **delivery**, sales, support, cmo, ops | founder, cfo, **delivery**, **sales**, support, cmo, ops | founder, cfo, cmo, support, ops, **people** | founder, **product-dev**, cmo, cfo, support | founder, cfo, cmo, support, **sales**, ops, **delivery** |
| Largest team | CFO (6 sub-agents) | **Delivery (6)** | CFO = Delivery (6 each) | CFO (7) | CMO (6) | CMO (8) |
| Sales team? | No | Yes — 2 sub-agents | Yes — 5 sub-agents | No | No | Yes — 3 sub-agents |
| Fulfillment/Inventory? | Yes | No | No | No (removed by customize) | No | No |
| Delivery team? | Yes — 1 sub-agent (Etsy listing copy) | **Yes — 6 sub-agents, largest team** | Yes — 6 sub-agents | **No** | No | Yes — 1 sub-agent (gallery delivery) |
| Compliance sub-agent? | Yes (attaches to CFO) | Yes (attaches to CFO) | **Yes, x2** (generic + mortgage-specific licensing) | Yes (attaches to CFO) | No | No |
| Category corrections logged | 2 | 0 (3 proposed, reverted — see below) | 3 | 2 | 1 | 2 |

## Which roles/teams appear in one chart but not the others?

- **Delivery** — present in candles, bookkeeping, mortgage, and wedding photographer; **absent from makerspace and SaaS**. For makerspace this is a legitimate finding, not a bug (see the dedicated section below). For SaaS it's expected: the paid product is software, which already has its own correct category (`product-dev`) — delivery exists specifically to rescue tasks that would otherwise wrongly cluster into `cfo`/`ops`/`cmo`, not to relabel a team that's already correctly named.
- **Sales** — present in bookkeeping, mortgage, and wedding photographer; **absent from candles, makerspace, and SaaS**. Consistent with the original catalog prediction (marketplace/creator/pre-revenue businesses don't need active deal-closing) plus the two new client-acquisition-heavy businesses (bookkeeping referrals, mortgage realtor partnerships) correctly getting one.
- **Product/Dev** — only in the SaaS chart, as before.
- **People** — only in makerspace (hiring signals for weekend-class instructors/maintenance staff).
- **Compliance** (as a sub-agent, always attached rather than a standalone team) — present in every chart except SaaS. Mortgage brokerage is the standout: it has *two* distinct compliance sub-agents — the generic contract/regulation tracker every service-template chart gets, plus an idea-specific "Mortgage Licensing & Disclosure Compliance Tracker" (NMLS renewal, state license CE credits, RESPA/TILA disclosure deadlines) that the customize pass added specifically for this idea.

## Checking the predicted outcomes

**Candles: lacks a Sales team, has heavy fulfillment.** ✅ Confirmed, same as the v1 report.

**Bookkeeping: updated prediction — Delivery team largest, Sales second, CFO small.** ⚠️ Partially confirmed. Delivery *is* the largest team (6 sub-agents / 7 tasks: reconciliation, POS-to-bank matching, client P&L reporting, plus the 3 generic delivery-scaffold tasks) — this is the core fix working as intended, and a clear improvement over the v1 report where the paid deliverable inflated CFO instead. But Sales did **not** land second — it shrank to 2 sub-agents (proposal builder + a customize-added referral-outreach agent) because this run's customize pass judged lead-scoring and cold-outreach unnecessary for a referrals-only local strategy, leaving CFO (5 sub-agents: the business's own invoicing/expenses/taxes/cashflow + the generic compliance sub-agent) as the second-largest team instead. This is explainable, idea-driven customize behavior, not the engine converging charts — but it means the exact ranking the fixture description predicted didn't hold this run.

One more finding here worth flagging on its own: the category-validation pass tried, three times, to move the reconciliation/expense/reporting tasks *back* from `delivery` into `cfo` — directly against its own category definitions — with reasoning like "it's the paid deliverable but it's finance-shaped, so it should be cfo." Applying those corrections recreated a real Hands-scope violation (a `cfo`-tagged task and a `delivery`-tagged task both ended up using the identical `handsTool` string, which is exactly the cross-tenant-credential mistake the scope guard exists to catch). The pipeline now handles this by discarding corrections that would break that hard invariant and falling back to the customize pass's original, already-safe categorization — which is why 0 corrections show as applied above despite 3 being proposed. Both halves worked as designed (the guard caught a real violation; the pipeline recovered instead of crashing), but the haiku validator's persistent bias toward "finance-shaped work = cfo" regardless of who it's for is a real, not-fully-resolved limitation — see Known limitations.

**Mortgage brokerage: Compliance attaches, compliance-adjacent tasks default to locked, licensing/disclosure tasks appear.** ✅ Confirmed on all three counts. Compliance attaches to CFO (no standalone team). 5 of the Delivery team's 6 sub-agents are `locked` (never-autonomous) by default — the one exception (document-checklist-and-chase) is explicitly the kind of routine reminder work that's safe to earn autonomy. And the customize pass added an idea-specific compliance sub-agent naming NMLS renewal, state-license CE credits, and RESPA/TILA disclosure deadlines — real regulatory specifics for this exact business, not generic filler — tagged `locked`.

**SaaS: centers on Product/Dev.** ✅ Confirmed, consistent with the v1 report. Product/Dev remains the only team with build/deploy machinery and a `GitHub` Hands tool.

## Makerspace: what the blend logic actually did

This fixture ("paid memberships, equipment rentals, and weekend classes") was chosen as a deliberate template-breaker, and it behaved like one:

- **Template selection was a near-coin-flip.** `ecommerce` and `local` tied at a score of 1 each (neither template's keyword list contains anything like "makerspace," "membership," or "rental" — the only signal was the `channels: local` answer triggering local's one point of channel bonus). `ecommerce` won only because it's first in iteration order, not because it's a better fit. This is a real gap in the template selector, not a felicitous accident.
- **No Delivery team emerged — and that's arguably correct, not a miss.** Unlike the finance-adjacent businesses, none of the makerspace's core paid tasks (membership tracking, class scheduling, equipment invoicing) were being wrongly bucketed into cfo/ops in a way that needed rescuing: membership/rental *billing* genuinely is cfo's job, and *scheduling* classes and equipment genuinely is ops's job. The taxonomy held up here even without a dedicated team for "the space business."
- **Two idea-specific tasks landed somewhere defensible but imperfect:** "Equipment Maintenance Monitor" and "Safety & Liability Flag Agent" were tagged `compliance` (which attaches to CFO), which is reasonable for the liability/waiver angle but means facility/equipment upkeep — arguably an Ops concern — ends up reported under the CFO team's banner purely because compliance has nowhere else to attach.
- **No team cleanly represents "the physical space itself."** Scheduling is split across Ops (class/equipment calendars) and Founder (a customize-added "Equipment Reservation Monitor" that flags booking conflicts directly to the founder rather than routing through a team). A business built around a shared physical resource doesn't map cleanly onto a taxonomy built for goods/services/software/content.

**Template-improvement follow-up filed:** GitHub issue "Template improvements from makerspace fixture findings" (MVP-0 milestone) tracks folding these findings back into the templates/selector — specifically, keyword coverage for space/membership businesses and reconsidering whether `local` needs its own generic "facility operations" cluster the way `service` now has `delivery`.

## Hybrid stress test: wedding photographer

Three distinct revenue lines (photography service, Lightroom presets, editing courses) coexisted without collapsing into each other: CMO carries idea-specific sub-agents for each line separately (trend research for presets, lead-nurture for the free-sample funnel, before/after visual content for photography), Support gained a course-specific sub-agent (Teachable-scoped) distinct from general triage, Sales gained a wedding-booking-specific sub-agent distinct from general outreach, and Delivery holds the one task that's genuinely a paid handoff across all product lines (gallery delivery via Pixieset). No team swallowed another product line's work — the differentiation held up within a single chart, not just across charts.

## Known limitations

1. **The category validator has a persistent bias toward re-collapsing finance-shaped delivery work into `cfo`**, even when the categories module explicitly says not to (see the bookkeeping finding above). The Hands-scope guard catches the resulting hard-invariant violations and the pipeline recovers by discarding those specific corrections, so no chart is corrupted — but this means the validator itself is not fully trustworthy on this one distinction and its corrections should be spot-checked, not taken as authoritative, until this is tuned further.
2. **Template selection has no real signal for space/membership businesses** (see Makerspace section) and resolves ties by object key order rather than any principled tiebreak — worth fixing before the selector is trusted for genuinely ambiguous ideas.
3. A few other single-task category calls this run are debatable-but-plausible rather than clearly right or wrong (e.g. `api-health-monitor` moved from `product-dev` to `cmo` for the SaaS chart) — normal noise at this batch size, not a pattern.

## Verdict: **PASS**

All six charts are structurally distinct in idea-appropriate ways: different team sets, different largest teams, different Hands tools, different idea-specific sub-agents, and (within the wedding photographer chart) different product lines staying visually separate rather than collapsing. The delivery-team concept demonstrably fixed the v1 report's core complaint — bookkeeping's paid deliverable no longer inflates CFO, it has its own team and is that chart's largest. The compliance path performed exactly as specified for a regulated business. The one deliberately-adversarial fixture (makerspace) produced a strained-but-defensible chart with a real, specifically-diagnosed gap rather than either a clean success or a silent failure, which is the useful outcome for a template-breaker. No two charts converged.

## Cost notes

$0.1964 is the total for this six-fixture run as committed. Getting here took several iterations within this session — two rounds of category-definition tuning (a validator regression where trend-spotting tasks kept getting pulled into `product-dev`) and one pipeline robustness fix (defensive handling of a tool call that omitted a "required" field, and the correction-reversion behavior described above) — each iteration re-ran some or all fixtures. Those intermediate runs are not part of the committed test but did consume additional API budget during development.
