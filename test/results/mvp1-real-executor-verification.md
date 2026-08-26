# MVP-1 real-executor verification — passing report

Closes issue #19 (test-gate): "BYOK key flow + spend walls + Charter compile/handoff + ONE role executing with full approval queue + per-sub-agent cost dashboard" (master-plan-v2.md §5, MVP-1 row). Full incident/investigation record: `docs/DECISIONS.md` ADR-033 (2026-08-22).

This report exists because ADR-033 itself is a narrative investigation record, not a test-gate closing artifact — per `docs/TRACKING.md`'s own rule, a test-gate issue closes only with a linked passing report committed here, not on code merged (or, in this case, an ADR merged) alone. Everything below is drawn directly from ADR-033's own verified findings; no new claims are introduced.

## What was verified, and how

A real scheduled dispatch was triggered end to end against tenant Acme (a genuine signup, not synthetic fixture data), using the actual product code path — `Router.submitTask` via `apps/api/src/scheduler/scheduledDispatchProcessor.ts` — not a mock, stub, or simulated result.

| Criterion (MVP-1 row) | Verified how |
|---|---|
| BYOK key flow | Acme's real Brain key, connected through the actual product flow, was resolved by `OpenMultiAgentExecutor` for this dispatch — not a platform key, not a test double. |
| Spend walls | `CostGate.evaluateAndReserve` reserved **$0.027306** against Acme's real ceiling at 2026-08-22T20:06:07Z, before the executor ever ran. |
| Charter compile/handoff | The dispatched task (Acme's chief-of-staff CEO-tier task, "Draft the weekly plan and flag cross-team conflicts for the founder") came from Acme's real, previously-compiled and handed-off Charter cascade — not a hand-constructed test input. |
| One role executing with full approval queue | The chief-of-staff role executed for real and its output landed in `approval_queue_items` as a `recommendation` at 2026-08-22T20:07:16Z (~71 seconds end to end) — routed through `submitRecommendation`, not `submitProposedAction`, with `effect` structurally absent, matching T10's CEO-tier enforcement exactly. |
| Per-sub-agent cost dashboard | The $0.027306 reservation is queryable per-role through the same `PostgresCostActivityQueries` path the dashboard reads — this dispatch is a real row in that data, not a number asserted only in a test. |

## The output itself

A full, coherent, Acme-specific weekly plan: team-by-team deliverables across every one of Acme's actual org-chart roles (Client Bookkeeping Reconciler, Tax Deadline Monitor, Regulatory Compliance Tracker, and others, all reasoning correctly about a real freelance-bookkeeping SaaS product — Acme's actual business, not a generic placeholder), five genuinely cross-team conflicts with specific dollar/timeline reasoning against the real $50 budget ceiling, and a correct, self-stated restatement of its own T10 constraint ("My only output pathway is the approval queue... not an instruction to any team") — matching exactly what `Router.submitTask` actually enforces for CEO-tier tasks.

## Infrastructure findings surfaced along the way (already fixed or tracked separately)

Getting to this result required fixing three real, independent bugs first (Upstash quota exhaustion, two bugs in the verification trigger script itself) — full detail in ADR-033. None of them are re-litigated here; they don't bear on whether the MVP-1 capability itself works, only on how hard it was to observe. One finding did feed directly into separate tracked work: `router_tasks` was confirmed unwritten by any code path at verification time, which became issue #120 — since fixed and shipped (PR #172, ADR-039, merged 2026-08-26).

## What this report does not claim

- **Not** a claim that issue #20's kill/advance metric (≥35% of chart-completers connect a key) is met — that needs real signup volume, not this verification.
- **Not** a claim that #21's CEO-recommendation approve-rate metric (≥30%) is met — same reason.
- **Not** a claim that every other open issue referencing MVP-1 adjacent work (#13/#14/#16/#17/#22/#37) is closed — each is verified independently against its own acceptance criteria (see `docs/DECISIONS.md`/issue comments for that pass, done separately from this report).

What this report closes is narrower and specific: the MVP-1 row's own five-part criterion, demonstrated working end to end against a real tenant, with real cost, real Charter data, and a real approval-queue row as evidence.

## Verified

Real dispatch, single occurrence, directly observed: cost-gate audit log entry, `approval_queue_items` row, both timestamped and cross-referenced (ADR-033). No test-suite changes accompany this report — it documents an operational verification already performed, per the test-gate rule requiring a committed report rather than re-deriving the evidence.
