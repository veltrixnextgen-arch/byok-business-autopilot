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
