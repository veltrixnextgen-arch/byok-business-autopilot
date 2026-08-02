# Architecture Decision Log

## ADR-001 — Bottom-up assembly order
**Date:** 2026-07-31
**Context:** The org chart must be derivable consistently from any business idea.
**Decision:** Assembly order is strict: tasks → sub-agents → teams → roles. Roles are assembled last to lead each team, never designed top-down.

## ADR-002 — Brains vs. Hands are separate key types
**Date:** 2026-07-31
**Context:** LLM provider access and service-API access have different scopes, risk profiles, and collection timing.
**Decision:** Brains (LLM providers, per-role) and Hands (service APIs, per-sub-agent, collected just-in-time) are separate key types with separate lifecycles in the vault.

## ADR-003 — Platform pays for onboarding only
**Date:** 2026-07-31
**Context:** Free-execution abuse and trial economics were the biggest v1 cost risk.
**Decision:** Platform pays AI inference ONLY for onboarding (capped cents/signup); everything after the Charter handoff is BYOK.

## ADR-004 — CEO agent is a recommender by architecture
**Date:** 2026-07-31
**Context:** Autonomous execution by a synthesizing agent is a safety and trust risk.
**Decision:** The CEO agent is a recommender by architecture — its only output pathway is the approval queue. It can never execute directly.

## ADR-005 — Trust core is CODEOWNERS-locked
**Date:** 2026-07-31
**Context:** The router, vault, cost gate, and approval queue are the security-critical trust core of the system.
**Decision:** Trust core (router, vault, cost gate, approval queue) is CODEOWNERS-locked; no AI-generated merges without human review.

## ADR-006 — Trust-core dependencies are pinned; the orchestration library is accessed only through our executor interface
**Date:** 2026-08-01
**Context:** `apps/router/` depends on the third-party `@open-multi-agent/core` package. A bare `open-multi-agent` name collision on npm (an unrelated project by a different author) already showed how easy it is to pull in the wrong thing; an unpinned version or a direct import scattered through business logic would make both a supply-chain compromise and a future swap-out far more dangerous and expensive.
**Decision:** Trust-core dependencies (starting with `@open-multi-agent/core`) are pinned to exact versions with a committed lockfile — no `^`/`~` ranges, no floating updates. Business logic never imports the orchestration library directly; it only ever goes through our own `AgentExecutor` interface (`apps/router/src/executor.ts`), so the library can be upgraded, patched, or replaced behind that interface without touching callers.

## ADR-007 — LocalKms is refused in production
**Date:** 2026-08-01
**Context:** `packages/vault`'s dev-only `LocalKms` stores the master key in a local file — no rotation, no HSM, no access audit on the master key itself. That's an acceptable dev convenience and an unacceptable production posture (T1: user API key theft) if it ever ships by accident (e.g. a missing env var in a deploy config).
**Decision:** Constructing `LocalKms` while `NODE_ENV=production` (or explicit `PRODUCTION=true`) throws `ProductionKmsGuardError` instead of silently working. Production must construct a real `Kms` implementation (`CloudKms` or equivalent) — there is no code path where a misconfigured production deploy quietly falls back to a file on disk.

## ADR-008 — Router refuses to construct in production without a CostGate and an ApprovalQueue
**Date:** 2026-08-01
**Context:** Both dependencies are optional constructor arguments on `Router` (dev/test convenience — the router's own tests don't need cost-gate or approval-queue machinery to verify tagging/dedup/ledger behavior). Nothing before this stopped a misconfigured production deploy from constructing a `Router` with one or both omitted, silently running every task with no spend limit (T4) and no human review before an effect runs (T10, security-architecture.md §5).
**Decision:** Same pattern as ADR-007: constructing `Router` while `NODE_ENV=production` (or `PRODUCTION=true`) throws `ProductionRouterGuardError` unless both a `CostGate` and an `ApprovalQueue` are provided. Dev/test code paths are unaffected — both remain optional outside production.

## ADR-009 — The shell/trust-core integration seam is an ESLint rule, not a convention
**Date:** 2026-08-01
**Context:** `apps/api` (and, later, `apps/web`) is the Emergent boundary side of the system — it's expected to iterate quickly, including with AI-generated changes, while trust-core (router, vault, cost gate, approval queue — ADR-005) stays CODEOWNERS-locked and slow-moving. If shell code ever reaches past a trust-core package's public `index.ts` into its internals (e.g. `@byok/vault/src/kms.js` instead of `@byok/vault`), the CODEOWNERS lock stops meaning much: internal APIs can change shape without the shell noticing at review time, and the shell can end up depending on implementation detail no one meant to expose. Relying on code review discipline alone to catch this doesn't scale, especially once AI-assisted changes are landing in the shell regularly.
**Decision:** `eslint.config.js` at the repo root applies a `no-restricted-imports` rule to `apps/api/**` and `apps/web/**` that blocks any import path matching `@byok/{router,vault,cost-gate,approval-queue}/*` — only the bare package import (which resolves to that package's `index.ts`) is allowed. This fails the build the same way a typecheck failure would; it isn't advisory. Trust-core packages themselves are not subject to this rule (they're allowed to reference each other's internals only through the same public interfaces, but that's enforced by their own existing design, not this rule). CI (see `.github/workflows/ci.yml`) runs `npm run lint` on every PR so a violation blocks merge before a human reviewer ever needs to notice it by hand.

## ADR-010 — Phase B is built by Claude Code under PR-per-issue discipline, not Emergent
**Date:** 2026-08-01
**Context:** The original plan (master-plan-v2.md §4, README) named Emergent as the Phase B builder, on the premise that a separate visual-design tool would generate the commodity UI surface fast and Claude Code would stay out of its way. In practice the scaffold Emergent was meant to generate already exists — Phase A's shell (`apps/api`, `packages/auth`, `packages/db`, `packages/jobs`) was built by Claude Code, is CODEOWNERS-reviewed, and Phase B needs to build directly on it rather than have a second tool re-derive or duplicate it. There's also no reason the containment fence built for Phase A (CODEOWNERS, the ADR-009 lint boundary, branch protection, required CI) should apply only to trust-core or only to one code generator — a UI bug or a boundary violation lands the same way regardless of which tool wrote the diff.
**Decision:** Phase B's commodity surface (`apps/web` and its supporting work) is built by Claude Code, one branch and one PR per step, each referencing a tracked issue, each requiring the same CODEOWNERS review, ADR-009 lint boundary, and required CI checks as everything else in this repo. This is a statement about which generator is producing shipped code, not a relaxation of the fence: the fence (CODEOWNERS, lint boundary, branch protection, CI) applies to every code generator equally, whether that's a human, Claude Code, or any other tool. External design tools (Figma, reference mockups, etc.) may inform the visual design, but they produce visual references only — no code from them enters the repo directly; it's implemented and reviewed the same as everything else.

## ADR-011 — The interview extracts the value chain, not founder preferences
**Date:** 2026-08-01
**Context:** Early onboarding-flow drafts mixed two different kinds of questions: ones that determine the actual STRUCTURE of the business (who pays, for what, how money and delivery move, which jurisdiction's rules apply) and ones that reflect the founder's PREFERENCES about how their company should run (which role to hire first, how much autonomy to grant agents). The first kind changes what org chart gets assembled — ADR-001's bottom-up task → sub-agent → team → role derivation depends on getting the value chain right. The second kind doesn't change the org chart at all; it changes settings on top of an org chart that's already correct. Conflating them made the interview longer than it needed to be and put configuration decisions (autonomy posture, especially) in a place — early onboarding, before the user has seen any real output — where they're hardest to make well.
**Decision:** The interview extracts the value chain only, walking inward from customer to CEO: what customers pay for → who the customer is → how money arrives → how delivery reaches them → jurisdiction. Founder-preference questions — first-hire priority, autonomy posture, and anything else that's a setting rather than a structural fact about the business — are configuration and live outside the interview, asked later at the point where they're actually actionable (e.g. autonomy posture during the BYOK/ceiling flow, once the user has a real role in front of them to grant autonomy to).

## ADR-012 — Trust-core review is a required CI attestation check, not an unsatisfiable approval requirement

**Date:** 2026-08-01
**Context:** Branch protection on `main` required an approving CODEOWNERS review before merge (issue #10's close-out). That's unsatisfiable as configured: every PR in this repo is authored by the `veltrixnextgen-arch` account (via the `gh` CLI), which is also the only entry in `.github/CODEOWNERS` — and GitHub does not allow an account to approve its own pull request. The first real attempt to merge a reviewed, CI-green PR (#29) hit this directly: `gh pr merge` refused with "the base branch policy prohibits the merge," not because anything was wrong with the PR, but because the required review could never exist. Removing the requirement outright would drop trust-core protection to "CI green" with no human-attention signal at all — acceptable for `apps/web` commodity-surface work, not for `packages/vault`, `packages/cost-gate`, `packages/approval-queue`, `apps/router`, `docs/architecture/security-architecture.md`, or the CI/lint-boundary/CODEOWNERS files themselves (ADR-009's rationale for locking those applies just as much here).
**Decision:** Branch protection on `main` no longer requires an approving review (`required_pull_request_reviews` removed; `required_status_checks` with `strict: true` and `enforce_admins: true` stay as-is). `.github/CODEOWNERS` stays in place, unchanged, as the source of truth for which paths are trust-core. In its place, a new required CI job (`trust-core-attestation` in `.github/workflows/ci.yml`) diffs the PR against its base branch: if any changed path matches a trust-core entry from CODEOWNERS, the job fails unless the PR description contains the literal line `TRUST-CORE REVIEWED: veltrixnextgen-arch`. That line must only be added after actually reading the trust-core diff — it is a required, auditable, machine-checked attestation, not a rubber stamp, and it's git history on the PR itself rather than a review that could be dismissed or lost. PRs that don't touch a trust-core path merge on green CI alone, same as any other repo. **This is a stand-in, not a replacement**: the moment a second maintainer exists, restore `required_pull_request_reviews` with `require_code_owner_reviews: true` and retire this job — a real second reviewer is strictly better than a self-attestation, and this mechanism only exists because a single-account repo has no other way to get trust-core changes reviewed by anyone but the person who wrote them.

**Amendment (2026-08-02):** The `TRUST-CORE REVIEWED` line must be added by the human maintainer only — Claude Code must never add it, including when explicitly asked to in-session, and must decline and explain why if asked. The line is a factual claim that a human read the trust-core diff; having the AI agent add it — even at the maintainer's explicit request, even with full context on the change — makes the claim false and defeats the entire point of the mechanism (ADR-012 exists specifically because self-certification isn't a real review). **Honest record:** this had already happened once before the amendment — Claude Code added the attestation line to PR #27 at the maintainer's explicit request, before this constraint was written down. That PR shipped durable storage (issue #6) and was reviewed in substance across the session that produced it, but the line itself was not maintainer-added, which is exactly the gap this amendment closes. No further exceptions from here forward.
