# Runwisely — Project history and North Star reconciliation

**Generated:** 2026-09-03. Scope: every ADR from day one (2026-07-31) through today, reconciled against `docs/strategy/runwisely-north-star.md`'s own target architecture. This is the full-history companion to `docs/STATUS.md` (which only covers the delta since the last snapshot) — read STATUS.md for "what changed most recently," this for "everything, in order."

**Source discipline (the §0 rule, applied here too):** every "completed" line below names the ADR, PR, or commit that actually shipped it. Nothing here is aspirational — aspirational content lives in Part 2, explicitly labeled pending.

**The numbers:** 445 commits, 59 numbered ADRs plus 7 further decisions recorded as `ADR-PENDING` (not yet assigned a permanent number — see `docs/DECISIONS.md`'s own header), across 34 days (2026-07-31 → 2026-09-03).

---

## Part 1 — What's been completed, in order

### Week 1 (2026-07-31 – 08-01): trust core and the shell

The four load-bearing, CODEOWNERS-locked components (Router, Vault, CostGate, ApprovalQueue) and the architectural rules that keep them load-bearing:

- **ADR-001** — bottom-up assembly order (tasks → agents → teams → roles) fixed as the extraction contract.
- **ADR-002** — Brains (LLM keys) and Hands (service-tool keys) are separate key types with different scopes and lifecycles.
- **ADR-003** — the platform pays for onboarding only; execution is always the user's own key.
- **ADR-004** — the CEO agent is a recommender by architecture — its output can only enter the approval queue, never dispatch directly.
- **ADR-005** — trust core (`packages/{router,agents,vault,cost-gate,approval-queue}` at the time) is CODEOWNERS-locked.
- **ADR-006** — trust-core dependencies pinned exact; the orchestration library (`@open-multi-agent/core`) is only ever touched through our own executor interface, never called directly.
- **ADR-007** — `LocalKms` (dev-only) is refused in production by construction.
- **ADR-008** — `Router` refuses to construct in production without a real `CostGate` and `ApprovalQueue` wired in.
- **ADR-009** — the shell/trust-core integration boundary is an ESLint rule, not a convention someone can forget.
- **ADR-010** — Phase B (the commodity surface) is built by Claude Code under PR-per-issue discipline, not a no-code tool.
- **ADR-011** — the onboarding interview extracts the value chain (what the business actually does), not founder preferences.
- **ADR-012** — trust-core review is a required CI attestation check (`TRUST-CORE REVIEWED`), not an approval requirement nobody can satisfy.

### Week 1–2 (08-02 – 08-04): the extraction contract and early UI fixes

- **ADR-013** — `@byok/contracts` becomes the one shared source of truth for everything extraction produces and the UI consumes — no shape gets redefined locally.
- **ADR-014** — the platform-key onboarding batch is gated by the cost gate directly, bypassing `Router.submitTask` (a pre-tenant, pre-Router flow).
- **ADR-015** — the org chart is persisted against the signed-up *user*, not a tenant, until Charter handoff claims it (this is the exact design decision issue #38 and the RLS policy this session's backfill script had to work around both trace back to).
- **ADR-016** — a production-only `jsxDEV` crash in `apps/web`, root-caused and fixed.
- **ADR-017** — the product is named **Runwisely**; "BYOK" stays a concept, not the product name.
- **ADR-018** — `apps/web` screens must match the real design reference, with a stated reason in the PR for any deviation.

### Week 2 (08-07 – 08-14): OAuth, migrations, R2/R3 runtime foundations

- **ADR-019** — the dependency-audit CI gate can suppress specific, expiring, reasoned findings, but never lowers its severity floor or gets disabled outright.
- **ADR-020** — OAuth Hands credentials get structured storage, single-flight token refresh, and fail closed to draft-only on any refresh failure.
- **ADR-021** — Google Calendar OAuth connect: HMAC state (not server-side session storage), platform client secret in env config — code-complete, pending only a real verified domain (still the case today, see Part 2).
- **ADR-022** — migrations run on every boot, not just a tagged staging deploy, backed by an independent schema-currency check.
- **ADR-023** — template selection treats structured interview answers as the primary signal, idea-text keyword matching as secondary only.
- **ADR-024** — **R2**: the Company Charter becomes a versioned entity; its prompt cascade is generated deterministically, never by a second LLM call.
- **ADR-025** — **R3**: the scheduler ships cadence-only triggers, reuses `Router.submitTask` entirely for dispatch rather than a parallel path.
- **ADR-026** — staging boots on durable CostGate/ApprovalQueue storage; Router's own ledger/dedup are flagged as still in-memory (closed later — see ADR-039).

### Week 3 (08-18 – 08-22): hardening pass — Redis, connection pools, the first real-tenant verification

- **ADR-027** — `bullmq`/`ioredis` pinned exact together; every Redis connection guarded with a bounded readiness timeout.
- **ADR-028** — full trust-core durability audit; Vault's key storage becomes durable. Established the rule this project still follows: a guard only ships with its own fix, never speculatively ahead of one.
- **ADR-029** — deploy verification stops asking the platform what it deployed and instead asks the running process to report its own build SHA.
- **ADR-030** — `createPool` gets bounded `connectionTimeoutMillis`/`statement_timeout`/`idle_in_transaction_session_timeout`; pool-wait saturation logged (this is the exact mechanism this session's scheduler-stall diagnostic checked first, and found not to be the cause).
- **ADR-031** — `STAGING_KMS_MASTER_KEY` becomes a real persisted secret; a decrypt-path health signal replaces "connected" as actual proof a key still works.
- **ADR-032** — an undecryptable DEK is now recoverable on write and honestly reported on read, instead of crashing or blaming the user's connection.
- **ADR-033** — the first real-executor verification against Acme (the one real tenant): genuine agent output confirmed, plus three real infrastructure findings surfaced along the way.
- **ADR-034** — a circuit breaker stops a BullMQ Redis-error retry storm from becoming an unbounded cost leak (issue #160).
- **ADR-035** — issue #161's suspected output corruption traced end-to-end and found to not be a real code defect.

### Week 4 (08-25): durability sweep — Router, Vault, CostGate, ApprovalQueue all go real

- **ADR-036** — `WEB_ORIGIN` was hardcoded to trust exactly one origin; attaching the real custom domain had silently broken sign-in until this was found and fixed.
- **ADR-037** — `ApprovalQueue`'s autonomy state moves to a real Postgres-backed `DurableAutonomyStore`, closing an accept-offer split-brain risk.
- **ADR-038** — a measured code-leanness pass: dead files removed, two dependencies dropped, four over-exported internals tightened.
- **ADR-039** — `Router` itself moves to real Postgres-backed `DurableTaskLedger`/`DurableDedupStore`, closing the last in-memory gap flagged back in ADR-026 (issue #120, closed).
- **ADR-040** — Vault's and CostGate's separate, bespoke audit logs are unified into one shared, durable `DurableAuditLog` (issues #149/#150, closed).

**This closes MVP-1's durability requirement**: Router, Vault, CostGate, and ApprovalQueue all read real Postgres, not in-memory state, as of 2026-08-25.

### 08-26 – 08-28: the database migration, real billing, and R5/R6 foundations

- **ADR-041** — first attempt to move the database from Neon to Supabase; two real Supabase-specific security defaults found and closed before any real data moved. **(This attempt never actually took — see ADR-059 below.)**
- **ADR-042** — a real staging environment stood up: second Supabase project, dedicated Railway environment, explicit deploy targeting.
- **ADR-043** — effect-dispatch stays draft-only for all of MVP-1/Phase 2 — a deliberate, closed decision (not an open question), given full weight again in this session's own report.
- **ADR-044** — real pricing set for the first time: $39/$89/$249.
- **ADR-045** — Stripe billing wired end-to-end: checkout, webhook, and the free-tier-upgrade hole closed (issue #18, closed).
- **ADR-046** — the bundle-size CI gate rewritten to read the real preload manifest instead of guessing from filenames.
- **ADR-047** — CostGate's pricing table becomes provider-scoped; real OpenAI/Google entries added.
- **ADR-048** — the executor now tells `@open-multi-agent/core` which provider to use — closes a live latent single-provider bug.
- **ADR-049** — template-learning capture layer: every task-list edit now records a durable, per-task delta instead of being silently overwritten.
- **ADR-050** — scheduled dispatch closes the last multi-provider gap: it looks up a role's real provider before picking a model.
- **ADR-051** — pricing re-differentiated on cadence, not agent/provider counts.
- **ADR-052** — **R5**: task chains ship as a pure, tested state machine and durable store — deliberately not yet wired into real dispatch.
- **ADR-053** — same-origin proxy for `apps/web`↔`apps/api` (issue #144) — code-complete, deliberately not cut over yet.
- **ADR-054** — **R6**: event-trigger webhook signature verification + per-tenant secret storage — deliberately capture-only, nothing dispatches from a verified event yet.
- **ADR-055** — extraction stays cross-origin, explicitly exempted from the same-origin proxy (latency headroom).
- **ADR-056** — same-origin proxy cutover to production (issue #144, closed).
- **ADR-057** — pricing collapses to one plan, three billing periods.
- **ADR-058** — website-as-input: paste a URL instead of typing an idea, SSRF-hardened.
- *(ADR-PENDING, 08-28)* — real per-agent, per-day spend ceiling — the first version of the mechanism PR #213 later had to patch for missing-field drift.
- *(ADR-PENDING, 08-28/29)* — three of four missing `Agent` fields added: `budget`, `objective`, `reportingStructure`.
- *(ADR-PENDING, 08-29)* — template-learning aggregation and redaction, structural only.

### 08-29 – 09-01: billing correctness, the session-expired bug, real Stripe verification

- *(ADR-PENDING)* — the company monthly cost ceiling actually resets monthly now (it didn't before).
- *(ADR-PENDING)* — price change: $39/$105/$374 → $39.99/$107.97/$383.90 (today's real, live price).
- *(ADR-PENDING)* — "session expired" root-caused as third-party-cookie blocking on cross-origin calls, not a race condition — fixed via Better Auth's `bearer()` plugin (PR #208).
- *(ADR-PENDING)* — `WEB_ORIGIN` was still pointed at the old Vercel domain post-custom-domain cutover; found and corrected.
- **PR #206–208** — the above three fixes, plus Stripe test-mode billing verified end-to-end against real staging (Checkout → subscription → webhook → tier/Stripe-id set → cancellation → tier revert), with a direct database row read, not just a 200 response.

### 09-01 – 09-02: the real Neon→Supabase cutover, North Star Tier 1, and the scheduler incident

- **ADR-059** — the real Neon-to-Supabase cutover. ADR-041's attempt never actually took — `DATABASE_URL` never durably held the Supabase value, and the live environment ran on Neon undetected for another week through real billing traffic. Found via an `ENETUNREACH`, root-caused precisely, and redone for real: wider tenant scope, byte-exact verification on every encrypted column, a live KMS-backed decrypt gate run without ever touching the running service.
- **PR #210 (North Star Tier 1, all four items, closed 2026-09-02):**
  - `Agent.brain` — model recommendation with a cost-grounded, checkable reason (`recommendBrain()`), wired into `assembleOrgChart`. Not retroactive — the 5 pre-existing tenant charts still show `brain: null` until regenerated.
  - Company Blueprint framing — `OrgChartScreen`/`CharterScreen` now present as one object. Presentation only; underlying data unchanged.
  - Per-agent budget override surface — `agent_budget_overrides` table + `/me/agent-budgets` route + inline `AgentsScreen` editor, actually enforced by `ceilingResolver`.
  - `Agent.riskTier` (low/medium/high) rendered on both org-chart screens, derived from task stakes.
- **PR #212** — issue #175 closed: both deploy-verification workflows now delete their own throwaway test account after running (`if: always()`), stopping the ~89-junk-tenant accumulation this had caused.
- **The scheduler incident, found and fixed (2026-09-02/03):** `perAgentDailyCeilingsFromOrgChart` crashed on every scheduled dispatch for Acme (the one real tenant) from at least 2026-08-19 — Tier 1's own `budget`/`riskTier` fields, added to the contract but never backfilled onto pre-existing stored charts (JSONB schema drift), with zero `worker.on("failed", ...)` logging anywhere to surface it. **PR #213** (merged, deployed live 2026-09-03T04:31 UTC): point fixes across 4 call sites, real-data backfill for all 5 tenants, the missing failure-logging listener added to both worker factories. The 30 stale failed Redis jobs this left behind were inspected (confirmed all pre-fix, same tenant, same error) and cleared. **PR #215** (open, awaiting trust-core attestation): the systemic fix — `normalizeOrgChart`, a migration-on-read step wired into the one real chokepoint (`SignupExtractionBatchStore.rowToBatch`), so the next contract field addition needs a default added in one place instead of hunted down across every consumer.
- **Docs:** `docs/STATUS.md` regenerated, North Star §3 and `runwisely-master-vision.md`'s own reconciliation table corrected in place (the "proven running unattended" claim, made before the incident was found, was false for three of the weeks it was live) — PR #214. `CLAUDE.md` established the standing rule this document and STATUS.md now both operate under.

---

## Part 2 — What's pending, against the North Star plan

Structured exactly as `docs/strategy/runwisely-north-star.md` §§3–5 define it — this section doesn't relitigate that reconciliation, it summarizes what it says is still open, for planning purposes. See that document for the full per-row detail and code citations.

### Blocking a real customer launch (ranked by revenue/value impact — from `docs/STATUS.md`)

1. ~~Scheduler silently non-functional for 3 weeks~~ — **fixed, PR #213**, live since 2026-09-03T04:31 UTC. A real post-fix dispatch has not yet been directly observed (next natural firing 2026-09-03T18:31 UTC).
2. **Effect-dispatch stays draft-only** (ADR-043, deliberate) — the real ceiling on value delivered today. Not scheduled to change before real pilot usage.
3. **Google OAuth verification not yet submitted** — code-complete since ADR-021 (2026-08-12); the submission itself is the remaining step, not engineering.
4. **2 of 5 North Star validation gates (§4) still open** — both need real usage, not code: ≥20 testers at ≥70% "taught me something," ≥35% key-connection rate.
5. **JSONB schema drift as a recurring bug class** — the point fix shipped in PR #213; the systemic fix (migration-on-read, this session) is in PR #215, open.
6. **Company Graph / Skill layer / Capability Registry / Company Memory / outcome learning — correctly not started.** Tier 2/3, gated behind item 4's validation gates clearing.

### North Star §4 — validation gates (nothing in §5 Tier 2/3 starts until these pass)

| Gate | Status |
|---|---|
| ≥20 testers, ≥70% "taught me something" | **Open** — needs real signup volume |
| ≥35% key-connection rate | **Open** — needs real signup volume |
| Billing proven end-to-end in test mode | **Done** (ADR-045, PR #206–208, verified live 2026-09-01/02) |
| Google OAuth verification submitted | **Open** — code-complete, submission itself pending |
| First paying customer | **Open** |

### North Star §5 — sequenced roadmap beyond today

- **Tier 1 (buildable now, ungated) — done**, PR #210, 2026-09-02: model recommendation with reasoning, Company Blueprint framing, per-agent budget overrides, risk-tier presentation layer. All four explicitly caveated in §3 as either not-retroactive or presentation-only where the underlying mechanism hasn't changed.
- **Tier 2 (after the validation gates clear) — not started, correctly:** Company Graph, Skill layer, Capability Registry, wiring `@byok/chains`/`@byok/webhooks` into real dispatch, existing-business before/after mapping.
- **Tier 3 (after paying customers) — not started:** Company Memory, objective-driven orchestration, verification/error-correction engine, outcome learning, cross-provider model routing with fallback.
- **Tier 4 (the demonstration) — not started, explicitly gated on MVP-2 paying traction:** the software-development workforce (MVP-3).

### What can wait (not on any critical path right now)

Per STATUS.md's own ranking: everything in Tier 2 and beyond. Building ahead of the validation gates is explicitly against this project's own sequencing rule (North Star §0 and §4) — the gates are cheap to clear for real and expensive to skip past on assumption.

---

**Regenerate, don't hand-edit.** Like STATUS.md, this is a snapshot derived from `docs/DECISIONS.md`, `docs/TRACKING.md`, and `docs/strategy/runwisely-north-star.md` — when those move, regenerate this rather than patching it out of sync with its own sources.
