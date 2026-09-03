# Project status

**Generated:** 2026-09-02, updated 2026-09-03 after PR #213/#215/#217 merged and PR #218 (Week 1's narrow real-effect-dispatch scope). Regenerate rather than hand-edit stale sections — this is a snapshot, not a living narrative; `docs/DECISIONS.md` (ADRs) and `docs/TRACKING.md` (incident history) are the durable record this is derived from. **Standing rule as of this snapshot: this file and `docs/strategy/runwisely-north-star.md` §3 get updated in the same PR as the code they describe — see the note at the bottom of this file.**

## What's blocking a real customer launch, ranked by revenue/value impact

Not the roadmap — the actual question. Ranked by what stops taking money or delivering the value already promised, not by build order.

1. **Fixed and deployed live: scheduled dispatch was silently non-functional for the one real tenant for three weeks.** `apps/api/src/routes/ceiling.ts`'s `perAgentDailyCeilingsFromOrgChart` crashed on every dispatch for Acme from at least 2026-08-19 — a JSONB schema-drift bug (`agent.budget` missing on a stored chart older than the field), with zero failure logging anywhere in `packages/jobs` to surface it. This was the single biggest gap between "architecturally sound" and "actually delivering value": an agent that never runs delivers nothing regardless of what's billed. **Fix + real data backfill + a `worker.on("failed", ...)` listener merged in PR #213, live on Railway `@byok/api` since 2026-09-03T04:31 UTC (commit `95d607e`)** — boot-verified clean. The 30 failed jobs the bug left in Redis (all pre-fix, same error, same tenant) were inspected and cleared. **Not yet directly observed: a real scheduled dispatch succeeding post-fix** — the next natural firing is 2026-09-03T18:31 UTC; this line gets corrected again once that's actually watched, not assumed. Nothing else on this list matters if this doesn't hold.
2. **Effect-dispatch is no longer draft-only for everything (ADR-043 partially superseded) — but only for one narrow task type so far.** `support.digest.weekly-summary` (SaaS template) now proposes a real "send" effect; `ResendEffectExecutor` (`packages/approval-queue`) sends it for real via the tenant's own connected Resend key, only after a human APPROVE/MODIFY — earned autonomy is structurally unable to bypass an effect-bearing action regardless of task type (`queue.ts`'s `submitProposedAction`, see this PR). Every other task type stays draft-only; this is a proof of the mechanism, not a general "agents can send anything" system. Not yet observed landing a real email in a real inbox — the mechanism is real and tested in code; a live send needs a tenant whose chart includes this task, which requires either a fresh signup on the SaaS template or a deliberate backfill into an existing one (not done to Acme without asking first).
3. **Google OAuth verification not yet submitted** (as of this snapshot). The shortest concrete path from #2 toward "and it acts" (Google Calendar is the one real OAuth flow that exists, currently inert). Code side is done; submission is a today-item, in parallel with other work, not gated on it.
4. **Two of the five North Star validation gates are still open**, and both need real usage, not code: ≥20 testers at ≥70% "taught me something," and ≥35% key-connection rate. Billing is done (verified end-to-end in Stripe test mode, 2026-09-01/02). First paying customer is open by definition until the above move.
5. **Company Graph / Skill layer / Capability Registry / Company Memory / outcome learning — correctly not started.** These are Tier 2/3 per the North Star doc's own sequencing rule, gated behind item 4's validation gates. Listed here only so "what can wait" is explicit: everything past item 4 can, and should, keep waiting.

## Where we are against the roadmap

Per `docs/strategy/master-plan-v2.md` §4–5.

| Milestone | Target | Status |
|---|---|---|
| **MVP-0** — Extraction validated | Templates + customize pass + assembly produce a real org chart | **Done.** |
| **Phase A** — Trust core + shell | Router/Vault/CostGate/ApprovalQueue exist and enforce T-series controls | **Done.** |
| **Phase B** — Commodity surface | Onboarding, role cards, Charter editor, approvals UI, dashboard | **Done.** |
| **MVP-1** — First role live | BYOK key flow + spend walls + Charter compile/handoff + one role executing with full approval queue + per-sub-agent cost dashboard | **Functionally proven and durable.** Router/Vault/CostGate/ApprovalQueue all read real Postgres now (ADR-039/040), not in-memory state. Formal test-gate closure (issue #19) still open per `docs/TRACKING.md`'s own rule — needs a report committed to `test/results/`, not more code. |
| **MVP-2** — Full org | Multi-role handoffs, CEO recommendation loop, earned autonomy, JIT Hands, batching, skip-the-call, Agency workspaces | **Partially done** — CEO loop and earned autonomy are real and durable; risk-tiering added a presentation layer (Tier 1 item 4) without changing the underlying mechanism; multi-role handoffs/batching/Agency workspaces not started. |
| **MVP-3** — Deploy layer | User-owned repo, sandbox→staging→approve→deploy pipeline | **Not started** — explicitly gated on MVP-2 paying traction. |
| **Beyond MVP-3 — the runtime** (R1–R7) | Charter → cascade → scheduler → task chains → unattended execution | **R1–R4 shipped and durable** (ADR-039). **R5 (task chains, ADR-052) and R6 (event triggers, ADR-054) exist as unwired foundations** — real state machine/signature verification, neither reaches real dispatch. **R7 (threshold triggers) not started.** |

## What's shipped since the last snapshot (2026-08-26)

Full detail in `docs/DECISIONS.md`, ADR-039 through ADR-059, plus PR #210/#212/#213/#215/#217/#218.

| # | What | Verified how |
|---|---|---|
| ADR-039 | Router durability — real `DurableTaskLedger`/`DurableDedupStore`, closing a crash-orphans-a-reserved-cost-row gap | Integration suite against real Postgres |
| ADR-040 | Vault's and CostGate's own audit logs unified into one shared, durable `DurableAuditLog` | Same store, differentiated by `source` column, confirmed via real writes |
| **ADR-041/ADR-059** | **Database moved from Neon to Supabase — twice.** The first attempt (ADR-041, 2026-08-26) never actually took: `DATABASE_URL` never durably held the Supabase value, and the live environment ran on Neon, undetected, for another week through real billing traffic. Found via an `ENETUNREACH` on a since-corrected connection string, root-caused precisely (DNS match + Railway deployment history cross-referenced against Neon's own activity timestamp), and redone for real (ADR-059): wider tenant scope than the original Acme-only cut, byte-exact verification on every encrypted column, a real KMS-backed decrypt gate run without ever touching the live service, hardening re-verified by construction. | Live decrypt gate: all 6 of Acme's brain keys decrypted clean against Supabase using the real deployed KMS key. A real signup through the live UI confirmed present in Supabase, absent from Neon, at the exact timestamp of creation. |
| ADR-042 | A real second Supabase project + Railway environment provisioned for staging | Isolated secrets, fresh KMS key confirmed never reused from production |
| ADR-043 | Effect-dispatch stays draft-only for all of MVP-1/Phase 2 — a decision, not an open TBD. **Partially superseded by PR #218 below**, for one task type only. | Documented as a closed question with the three options actually considered |
| ADR-044/051/057 | Pricing set, then re-differentiated on cadence not agent count, then collapsed to one plan/three billing periods — current: $39.99/$107.97/$383.90 | Displayed math cross-checked against the real Stripe test-mode charge |
| ADR-045 | Stripe billing wired: checkout, webhook, free-tier-upgrade hole closed | Full real flow: Checkout Session → subscription → webhook → tier/Stripe-id set → cancellation → tier revert, verified against live Stripe test mode 2026-09-01/02, including a direct database row read (not just 200s) |
| ADR-046 | Bundle-size gate reads the real preload manifest instead of guessing from filenames | Worst-case route (146.21 KB gzip) now actually measured |
| ADR-047/048/050 | CostGate's pricing table becomes provider-scoped; the executor and scheduled dispatch both actually tell the model layer which provider to use | Real OpenAI/Google pricing entries; a live latent single-provider bug closed |
| ADR-049 | Template-learning capture layer — every task-list edit records a durable per-task delta | Real writes confirmed against migration `0016`'s table |
| ADR-052/054 | Task chains (R5) and event triggers (R6) ship as real, tested foundations — a state machine and signature-verified webhook storage — deliberately not wired into dispatch yet | Unit-tested in isolation; explicitly flagged as not-yet-real automation in the roadmap above |
| ADR-053/055/056 | Same-origin proxy for apps/web↔apps/api, with extraction deliberately exempted (latency headroom), cut over to production | Live CORS/cookie behavior confirmed post-cutover |
| ADR-058 | Website-as-input: paste a URL instead of typing an idea, SSRF-hardened | Per-redirect-hop re-validation tested against a real private-IP redirect |
| **PR #206–208** | Monthly cost-ceiling reset bug fixed; Stripe test-mode billing verified against real staging; "session expired" root-caused (third-party cookie block on cross-origin calls, not a race) and fixed via Better Auth's `bearer()` plugin; stale `WEB_ORIGIN` corrected | Live re-verification after each fix — a real signed-in user's dashboard load, a real checkout→webhook→cancellation cycle |
| **PR #210 (North Star Tier 1, all four items)** | `Agent.brain` model recommendation with a cost-grounded reason; Company Blueprint framing; a real per-agent budget override surface (table + route + UI); `Agent.riskTier` (low/medium/high) rendered on both org-chart screens | Full monorepo test suite green; a live browser pass confirmed the Blueprint framing and budget editor render correctly against Supabase |
| **PR #212** | Issue #175 fixed — both deploy-verification workflows now delete their own throwaway test account after running, `if: always()` | Live-tested the exact cleanup mechanism against a real test tenant before wiring it into CI |
| **PR #213 (merged, deployed)** | The three-week silent scheduler failure (see "blocking a launch," item 1) — root cause, code fix, real-data backfill, and the missing `worker.on("failed", ...)` listener, all in one PR | New tests cover the fallback explicitly; deployed live 2026-09-03T04:31 UTC, boot-verified clean; 30 stale failed Redis jobs (all pre-fix) inspected and cleared. A real post-fix dispatch has not yet been directly observed — next natural firing 2026-09-03T18:31 UTC |
| **PR #215 (merged)** | The systemic fix for JSONB schema drift — `normalizeOrgChart` (`@byok/contracts`), a migration-on-read step run in the one real chokepoint (`SignupExtractionBatchStore.rowToBatch`), so the next `Agent`/`Task` contract field needs a default added once, not hunted across every consumer | 6 new unit tests; caught and fixed a real bug of its own via CI (crashed on the partial/stub charts `packages/db`'s own integration tests use) before merge |
| **PR #217 (merged)** | Privacy policy / data-deletion pages corrected off a stale placeholder `.com` domain onto the real one (`runwisely.cc`) — was blocking Google OAuth verification, which requires the privacy policy to live on the same domain as the homepage | Updated tests pass; the specific blocker (wrong domain) is gone |
| **PR #218** | Week 1's narrow real-effect-dispatch scope: one task type (`support.digest.weekly-summary`, SaaS template) proposes a real "send" effect; `ResendEffectExecutor` sends it via the tenant's own connected Resend key, to the tenant's own owner/admin emails, only after a human APPROVE/MODIFY. Closed a real safety gap found while building it: `ApprovalQueue.submitProposedAction`'s earned-autonomy bypass could dispatch an effect with zero human review — now structurally impossible for any effect-bearing action, not just this one | New/updated unit tests across `packages/approval-queue` (46 tests), `apps/router` (60), `apps/api` (258) — full suite green. Not yet observed sending a real email to a real inbox — needs a tenant whose chart actually includes this task |

## Open issues, with trigger conditions

Every issue currently open, in one place, so nothing is only "known" from scattered PR history. Refreshed this snapshot — several close, several are new.

| # | Issue | Trigger condition — what would resolve or require this |
|---|---|---|
| N/A | JSONB schema drift on stored org charts | **Closed (PR #215).** `normalizeOrgChart` runs every stored chart through migration-on-read now. |
| **175** | **Closed (PR #212).** Deploy-verification test accounts never cleaned up, accumulating ~89 junk tenants on the live database. | Both workflows now delete their own account after running. |
| **159** | **Closed.** No safe "run now" path for scheduled dispatch. | `POST /me/scheduler/run-now` exists and works — confirmed live 2026-09-02 (no UI button wired to it yet, but the route itself is real and rate-limited/pause-aware). |
| 156 | KMS master key rotation has no design | Needed before any *deliberate* KMS rotation (versioned keys, re-encryption path). |
| 150/149 | CostGate's / Vault's own audit logs | **Closed (ADR-040).** Both now read the same shared, durable `DurableAuditLog`. |
| 144 | Same-origin proxy for apps/web + apps/api | **Closed (ADR-053/056).** Cut over to production. |
| 141 | No way for a user to change a task's own cadence | Product gap — cadence is currently fixed at extraction time. |
| 135 | `POST /me/scheduler/sync` returns a silent 200 | UX gap — the route already computes a real, useful result; it's just not surfaced. |
| 124 | Charter drafting silently breaks past a 3000-token ceiling | Needs a real org chart large enough to hit it, or a raised ceiling + real verification. |
| 120 | Router's TaskLedger/DedupStore are still in-memory | **Closed (ADR-039).** Both now Postgres-backed. |
| 112 | Cascade regeneration not wired for agent-rename/autonomy-change | Needs the post-claim org-chart-editing endpoints this was scoped out of (PR #94) to exist first. |
| 47 | Cost ceiling is a single shared pool, not per-tenant | Re-check now that Acme is a real tenant with real billing — worth confirming this is actually still shared, not just historically noted as such. |
| 38 | Org-chart-to-tenant handoff gap at Charter acceptance | Phase B commodity-surface gap. |
| 37 | Deep Router/CostGate integration for user keys | Likely stale — superseded by the real Vault/executor wiring since shipped. Worth closing on inspection rather than carrying forward again. |
| 24 | MVP-3 parallel build branch | Explicitly gated on MVP-2 paying traction — not actionable yet. |
| 23 | Multi-role handoffs + Agency workspaces | MVP-2 core scope — not started. |
| 22 | Just-in-time Hands granting flow | Partially real (`missingHands` mechanism exists in the executor). |
| 21 | CEO recommendation loop | **The mechanism is done and proven.** Open only on its kill/advance metric (≥30% approve rate) — needs real usage volume. |
| 20 | Key-connection rate instrumentation (test-gate) | Needs real signup volume — ≥35% target, can't be resolved by engineering. |
| 19 | One role executing end-to-end (test-gate) | **The capability is proven and now independently re-verified post-migration.** Open specifically because no report has been committed to `test/results/` yet. |
| 18 | Stripe billing for the four tiers | **Closed (ADR-045).** Verified end-to-end against live Stripe test mode. |
| 17/16 | Approval queue UI + digest + dashboard / Charter editor + handoff + cascade | Believed shipped and in real production use against Acme — not individually re-verified against each issue's exact acceptance criteria this pass. |
| 14/13 | Simulated-day player + value screen / Role-card deck | Status unconfirmed — not touched this snapshot either. |

## Live infrastructure, as of this snapshot

- **Domain:** `https://www.runwisely.cc` and `https://runwisely.cc`, both live, sign-in confirmed working (third-party-cookie fix, PR #208).
- **Backend:** Railway project `perceptive-generosity`, service `@byok/api`, environment `864d7816-d276-4b64-b018-81561c9593a6` (Railway's own dashboard calls this environment "production" — it is the one and only real deployed backend; a second Railway environment named "staging" exists and has never been deployed to. This naming inversion has already cost two diagnosis cycles — see `docs/TRACKING.md`).
- **Database: Supabase** (`ilptweslvrwbpddhhfuw`, "Runwisely"), **not Neon** — cut over 2026-09-02 (ADR-059) via the Session Pooler (`app_user.ilptweslvrwbpddhhfuw@aws-0-us-west-2.pooler.supabase.com:5432`, not the direct IPv6-only endpoint, not the transaction-mode pooler). Neon (`royal-sky-49178132`) stays live and untouched until **2026-09-09** before any deletion discussion.
- **Redis:** Upstash, pay-as-you-go, circuit breaker live on both workers (ADR-034).
- **Trust-core gate:** `packages/{router,agents,vault,cost-gate,approval-queue,db,jobs}` are all CODEOWNERS-locked — a PR touching any of them needs a human `TRUST-CORE REVIEWED` attestation before merge, enforced by CI, not just convention.

## Next up

1. **Confirm a real scheduled dispatch lands post-fix** — next natural firing 2026-09-03T18:31 UTC; PR #213 is merged and deployed but this specific observation is still open.
2. **Observe PR #218's real effect actually land in a real inbox** — the mechanism is built and tested; needs a tenant whose chart includes `support.digest.weekly-summary` (a fresh SaaS-template signup, or a deliberate backfill decision — not done unilaterally to Acme).
3. Submit Google OAuth verification — code side and the privacy-policy blocker (PR #217) are both done; submission itself is the remaining step.
4. Extend real effect-dispatch to Google Calendar once verification clears, then a real Hands connect flow for more task types — Week 2/3 per the current plan.
5. Formal test-gate closures (#19, #20, #21) — need a report committed to `test/results/` and real signup volume, not more code.
6. Everything in North Star §5 Tier 2 (Company Graph, Skill layer, Capability Registry, wiring `@byok/chains`/`@byok/webhooks`, existing-business mapping) stays correctly un-started until §4's validation gates clear.

---

**Standing rule (established this snapshot):** any PR that changes what the product actually does updates this file and `docs/strategy/runwisely-north-star.md` §3 in the same PR — the same discipline already applied to ADRs (`docs/DECISIONS.md`) and incidents (`docs/TRACKING.md`). A status report should arrive with the work, not get requested after the fact.
