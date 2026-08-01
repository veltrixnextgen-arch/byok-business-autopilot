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
