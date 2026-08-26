# Project status

**Generated:** 2026-08-26, from repo state at this commit. Regenerate rather than hand-edit stale sections — this is a snapshot, not a living narrative; `docs/DECISIONS.md` (ADRs) and `docs/TRACKING.md` (incident history) are the durable record this is derived from.

## Where we are against the roadmap

Per `docs/strategy/master-plan-v2.md` §4–5.

| Milestone | Target | Status |
|---|---|---|
| **MVP-0** — Extraction validated | Templates + customize pass + assembly produce a real org chart | **Done.** |
| **Phase A** — Trust core + shell | Router/Vault/CostGate/ApprovalQueue exist and enforce T-series controls | **Done.** |
| **Phase B** — Commodity surface | Onboarding, role cards, Charter editor, approvals UI, dashboard | **Done.** |
| **MVP-1** — First role live | BYOK key flow + spend walls + Charter compile/handoff + one role executing with full approval queue + per-sub-agent cost dashboard | **Functionally proven, formally still open** — see below. |
| **MVP-2** — Full org | Multi-role handoffs, CEO recommendation loop, earned autonomy, JIT Hands, batching, skip-the-call, Agency workspaces | **Partially done** — CEO loop and earned autonomy are real and durable; multi-role handoffs/batching/Agency workspaces not started. |
| **MVP-3** — Deploy layer | User-owned repo, sandbox→staging→approve→deploy pipeline | **Not started** — explicitly gated on MVP-2 paying traction. |
| **Beyond MVP-3 — the runtime** (R1–R7) | Charter → cascade → scheduler → task chains → unattended execution | **R1–R4 shipped** (cadence metadata, Charter+cascade, scheduler, digest). **R5 (task chains), R6 (event triggers), R7 (threshold triggers) not started.** |

**Why MVP-1 shows "functionally proven, formally still open":** every capability the milestone names is real and verified — BYOK connect flow, per-tenant/per-role spend ceilings, Charter compile/handoff, a real scheduled dispatch through the full approval queue (ADR-033, against tenant Acme, genuine non-mock output), and a working cost dashboard. What's still open is the milestone's own kill/advance criterion (issue #20: ≥35% of chart-completers connect a key after the simulated day) — that needs real signup volume over time, not more engineering — and issue #19's formal test-gate closure, which per `docs/TRACKING.md`'s own rule only closes with a passing report committed to `test/results/`, not on code merged alone.

## What's shipped, verified vs. assumed

This session's arc, in order (full detail in `docs/DECISIONS.md`, ADR-028 through ADR-038):

| # | What | Verified how |
|---|---|---|
| ADR-028 | Vault durability audit — Brain/Hands key storage moves to Postgres | Real Postgres integration suite; cross-tenant RLS isolation proven |
| ADR-029 | Deploy verification stops trusting the platform's own deploy-status API, uses a self-reported build SHA instead | Proven both directions against live staging (correct SHA passes, wrong SHA fails loud) |
| ADR-030 | Postgres pool timeout bounds; a self-caught regression (monkeypatching `pg.Pool` broke `pool.query()` internally) | Caught via a 24-minute test-suite anomaly; reverted, fixed at call sites instead |
| ADR-031 | `STAGING_KMS_MASTER_KEY` becomes a real persisted secret; a decrypt-path health signal replaces "connected" as proof a key works | Live incident (key was regenerated every deploy, silently orphaning DEKs) |
| ADR-032 | Undecryptable DEK recovers on write, fails honestly on read | Real reconnect for tenant Acme confirmed working live |
| **ADR-033** | **Real-executor verification against Acme** — genuine, non-mock, Acme-specific output confirmed through an actual scheduled dispatch | **Verified.** Real CEO-tier task, $0.027306 real cost, output read directly from a file (not a terminal paste) |
| ADR-034 | Circuit breaker stops a Redis-error retry storm from becoming an unbounded cost leak | 8 dedicated tests + confirmed the storm stopped in production logs. **Issue #160 closed** (this session — PR #163 had shipped the fix but never linked the issue) |
| ADR-035 | Issue #161's "corrupted output" was a terminal copy-paste artifact, not a runtime bug | Byte-clean file read of a second real dispatch's raw output |
| **ADR-036** | **`www.runwisely.cc` / `runwisely.cc` are now live** — CORS/`trustedOrigins` fixed to trust multiple origins, closing a sign-in outage on the new domain | Code verified (192/192 tests); **live sign-in test on the real domain is the user's own next step**, not yet confirmed at time of writing |
| **ADR-037** | **Autonomy durability** — `ApprovalQueue` reads a real `PostgresDurableAutonomyStore`, closing the accept-offer split-brain (`apps/api/src/routes/approvals.ts`'s accept-offer route used to write to a table live dispatch gating never read) | 38/38 approval-queue tests, including a structural proof (`acceptOffer()` flips `isActive` on the same store `submitProposedAction` reads) |
| **ADR-038** | **Code-leanness pass** — 3 dead scripts deleted, 2 removable dependencies dropped (which also retired 2 tracked `npm audit` exceptions), 4 over-exported internals scoped down, 1 missing dependency (`playwright`) added | `npm audit`: 0 vulnerabilities (down from 2). Full suite green across every touched package |

**The one item still genuinely unverified at the time of writing:** ADR-036's fix is code-complete and tested, and the Railway variable (`ADDITIONAL_WEB_ORIGINS`) is set — but a real browser sign-in on `https://www.runwisely.cc` hadn't been confirmed as of this snapshot. Don't treat it as done until that's confirmed.

## Open issues, with trigger conditions

Every issue currently open, in one place, so nothing is only "known" from scattered PR history.

| # | Issue | Trigger condition — what would resolve or require this |
|---|---|---|
| 159 | No safe "run now" path for scheduled dispatch | Build a real `POST /me/scheduler/run-now` (rate-limited, pause-aware). Currently stood in for by manual ops scripts (`packages/jobs/scripts/*.mjs`). |
| 156 | KMS master key rotation has no design | Needed before any *deliberate* KMS rotation (versioned keys, re-encryption path). ADR-032's discard-and-recreate is a stopgap for the *accidental* case, not this. |
| 150 | CostGate's own audit log is in-memory | Needed before this audit trail can be trusted to survive a restart — same shape as #149. |
| 149 | Vault's own audit log is in-memory | Same — key store/rotate/revoke/decrypt events vanish on restart today. |
| 144 | Same-origin proxy for apps/web + apps/api | The real, structural fix for cross-site cookies — ADR-036 made the *current* architecture correctly trust the real domain; this replaces the architecture itself. Deliberately deferred (per explicit sequencing decision) until after the domain launch stabilized. |
| 141 | No way for a user to change a task's own cadence | Product gap — cadence is currently fixed at extraction time. |
| 135 | `POST /me/scheduler/sync` returns a silent 200 | UX gap — the route already computes a real, useful result; it's just not surfaced. |
| 124 | Charter drafting silently breaks past a 3000-token ceiling | Needs a real org chart large enough to hit it, or a raised ceiling + real verification. |
| 120 | Router's TaskLedger/DedupStore are still in-memory | **Required before multi-replica or production traffic** — sharpened this session (ADR-033's investigation) to also block basic single-replica observability of in-flight tasks. Next up per the user's own sequencing, right after autonomy durability. |
| 112 | Cascade regeneration not wired for agent-rename/autonomy-change | Needs the post-claim org-chart-editing endpoints this was scoped out of (PR #94) to exist first. |
| 47 | Cost ceiling is a single shared pool, not per-tenant | Real blocker once multiple tenants are live simultaneously on shared infrastructure — worth re-checking now that Acme is a real, live tenant. |
| 38 | Org-chart-to-tenant handoff gap at Charter acceptance | Phase B commodity-surface gap. |
| 37 | Deep Router/CostGate integration for user keys | Superseded in spirit by the real Vault/executor wiring since shipped — worth a look at whether this is now stale. |
| 24 | MVP-3 parallel build branch | Explicitly gated on MVP-2 paying traction — not actionable yet. Scoping report requested separately (see "Next up"). |
| 23 | Multi-role handoffs + Agency workspaces | MVP-2 core scope — not started. |
| 22 | Just-in-time Hands granting flow | Partially real (`missingHands` mechanism exists in the executor) — worth checking whether this issue's specific acceptance criteria are actually still open or just never closed. |
| 21 | CEO recommendation loop | **The mechanism is done and proven** (ADR-033's real Grace dispatch). Open only on its kill/advance metric (≥30% approve rate) — needs real usage volume, not more code. |
| 20 | Key-connection rate instrumentation (test-gate) | Needs real signup volume — ≥35% target, can't be resolved by engineering. |
| 19 | One role executing end-to-end (test-gate) | **The capability is proven** (ADR-033) — this issue is open specifically because no report has been committed to `test/results/` yet, per `docs/TRACKING.md`'s own test-gate closure rule. |
| 18 | Stripe billing for the four tiers | Not started — next up per the user's own phase-2 sequencing. |
| 17 | Approval queue UI + morning digest + dashboard | Believed shipped (PR #146, #148) — worth confirming this issue's specific acceptance criteria are fully covered before closing. |
| 16 | Charter editor + handoff ceremony + cascade | Believed shipped (R2/ADR-024) — same caveat as #17. |
| 14 | Simulated-day player + value screen | Status unconfirmed this session — not touched. |
| 13 | Role-card deck | Status unconfirmed this session — not touched. |

**Note on #13/#14/#16/#17:** these read as already-shipped based on this session's own knowledge of the codebase (Charter editor, approvals UI, and dashboard are all real and in production use against Acme), but weren't individually re-verified against each issue's exact acceptance criteria in this pass — flagged rather than silently closed, since closing on an assumption would be exactly the kind of unverified claim this document is trying not to make.

## Live infrastructure, as of this snapshot

- **Domain:** `https://www.runwisely.cc` and `https://runwisely.cc` both attached to the Vercel project; sign-in fix deployed, live test pending.
- **Backend:** Railway project `perceptive-generosity`, service `@byok/api`, environment literally named `production` in Railway's own terms (there is still only one real environment — see issue-worthy gap noted in ADR-033).
- **Redis:** Upstash, pay-as-you-go (upgraded this session after a free-tier quota exhaustion incident), circuit breaker live on both workers.
- **Database:** Neon Postgres, RLS-isolated per tenant.

## Next up (per the user's own stated sequencing)

1. Confirm live sign-in on the real domain (ADR-036) — the one open verification loop.
2. Issue #120 — Router ledger/dedup durability (queued immediately after autonomy durability, which shipped this session as ADR-037).
3. Performance measurement — resolve the CI bundle-gate discrepancy (~127KB reported vs. ~194KB actually shipped) before measuring anything else against it.
4. Template-learning scoping (usage-data-driven template improvement, human-reviewed, no cross-tenant leakage) — scoping only, no code yet.
5. Stripe billing (#18), then MVP-2's remaining scope (multi-role handoffs, batching, Agency workspaces — #23).
