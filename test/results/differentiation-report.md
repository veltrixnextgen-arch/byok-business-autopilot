# MVP-0 Differentiation Test — Report

Run against `docs/product/roles-and-api-key-guide.md` Part 2's three canonical prompts, per `docs/strategy/master-plan-v2.md` §5's MVP-0 kill criterion: *"candle shop / freelance bookkeeper / unbuilt SaaS must produce visibly different charts."*

Raw org charts: [`candle-shop.json`](candle-shop.json) · [`freelance-bookkeeping.json`](freelance-bookkeeping.json) · [`saas-scheduler.json`](saas-scheduler.json). Model: `claude-sonnet-4-6`. Total API cost: **$0.0583** (3 runs, well under the $0.25/run cap).

## Summary table

| | (a) Candle shop (ecommerce) | (b) Freelance bookkeeping (service) | (c) SaaS scheduler (saas) |
|---|---|---|---|
| Template selected | `ecommerce` (score 5) | `service` (score 3) | `saas` (score 2.5) |
| Teams | founder, **cfo**, **cmo**, **ops**, support, product-dev | founder, **cfo**, **sales**, support, ops | founder, **product-dev**, **cmo**, cfo, support, ops |
| Teams / sub-agents / tasks | 6 / 19 / 21 | 5 / 17 / 19 | 6 / 14 / 16 |
| Largest team (by sub-agents) | CMO (5) / Ops (4) | **CFO (8)** | product-dev (4) = CMO (4), tied |
| Sales team? | **No** | **Yes — 4 dedicated sub-agents** (qualifier removed by customize, outreach/CRM/proposals/referral kept+added) | No |
| Fulfillment/Inventory? | **Yes — heavy** (inventory, fulfillment, vendor-manager: 6 sub-agent-tasks) | **No** | **No** |
| Product/Dev team? | 1 sub-agent (see caveat below) | **No** | **Yes — 4 sub-agents**, the pipeline's core (spec/build/QA/deploy) |
| Idea-specific Hands tools added | Shopify/Etsy, Etsy API, shipping carrier | QuickBooks/Xero API, CRM, Calendar | GitHub, Twitter/X |
| Idea-specific customize additions | Etsy analytics monitor, Etsy policy watcher, review-reply agent, production scheduler, candle trend researcher | Bookkeeping reconciler, sales-tax monitor, client P&L report builder, referral outreach | Social-API health monitor, competitive-intel agent, platform-constraints spec writer |

## Which roles/teams appear in one chart but not the others?

- **Sales** — only in (b). Absent from (a) and (c).
- **Inventory / Fulfillment / Vendor-manager** — only in (a). Absent from (b) and (c).
- **CMO** — present in (a) and (c); **absent entirely from (b)**. The customize pass removed bookkeeping's one CMO task ("draft occasional posts establishing expertise") with the reasoning that the founder dreads marketing and is running a referrals-only strategy — collapsing "minimal marketing" all the way to zero marketing, which is a sharper (and defensible) version of the catalog's prediction.
- **Product/Dev** — genuinely central only in (c) (spec writer, build agent, QA agent, deploy coordinator — the only chart with a `GitHub` Hands tool or `locked` build/deploy autonomy). It also shows up as a single sub-agent in (a) — see caveat below.
- **Founder/CFO/Support** — present in all three, but sized very differently: CFO has 5 sub-agents in (a), 2 in (c), and swells to 8 in (b) because the bookkeeping business's actual deliverable (reconciliation, sales-tax tracking, client P&L reports) clusters under the CFO categoryHint. CFO's *size itself* is a strong differentiator, even though it isn't the specific team the catalog names.

## Checking the three predicted outcomes from the role catalog

**(a) Candle shop lacks a Sales team.** ✅ Confirmed — no `sales` team in the chart at all.

**(b) Bookkeeping has Sales as its largest team, with no fulfillment.** ⚠️ Partially confirmed. No fulfillment/inventory tasks exist anywhere in the chart — clean pass on that half. But *by raw sub-agent/task count*, CFO (8 sub-agents / 9 tasks) edges out Sales (4 sub-agents / 4 tasks) as the largest team. This isn't the charts converging — it's a modeling artifact worth naming: for a bookkeeping business, the *paid deliverable itself* (reconciliation, sales-tax monitoring, client reporting) is finance work, so it clusters under the same `cfo` categoryHint as the business's own internal invoicing/expenses/taxes, inflating CFO's count beyond what the catalog's shorthand implies. Sales is still unambiguously present and prominent (present in *only* this chart, with 4 dedicated sub-agents including 2 idea-specific additions), which is the substantive signal the differentiation test cares about.

**(c) SaaS centers on a Product/Dev lead.** ✅ Confirmed in substance. Product/Dev is the only team across all three charts with build/deploy machinery, is tied for largest team in this chart (4 sub-agents, matching CMO), and every customize-added task (API health monitoring, competitive intel, platform-constraints spec) orbits the product. CFO and Support are explicitly "lite"/"waitlist" (2 tasks each), matching the catalog's description.

## Known limitation worth flagging

In chart (a), the customize pass added a task ("research trending candle scents... suggest new product ideas") and tagged it `teamHint: product-dev`, standing up a one-sub-agent "Product/Dev Lead" team for a candle shop that needs no software. This is product/market research, not software development — it's a mis-tag, likely because the fixed `teamHint` enum gave the model no better bucket than `product-dev` for "research new product ideas." It doesn't threaten the verdict below (one lite research sub-agent vs. (c)'s four core build-pipeline sub-agents with locked deploy autonomy is still a stark, readable difference), but a v2 of the customize tool schema should either add a `product-rd` hint distinct from `product-dev` (software), or constrain `product-dev` to only fire when the template itself is `saas`.

## Verdict: **PASS**

The three charts are structurally distinct in exactly the ways the catalog predicts: different team sets (Sales only in bookkeeping, Fulfillment only in candles, Product/Dev centrally only in SaaS), different team-size profiles, different Hands tools, and different idea-specific sub-agents — none of which could be swapped between charts without looking obviously wrong. The one caveat ((b)'s "largest team" not being literally Sales by headcount) is explained by a specific, understandable modeling choice rather than the engine collapsing distinct ideas into the same shape, so it doesn't undermine the differentiation test's purpose.
