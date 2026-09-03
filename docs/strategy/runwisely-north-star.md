# Runwisely — North Star Architecture

**The target architecture, reconciled against what exists, with an honest sequence for getting there.**
*Companion to runwisely-master-vision.md. This is the destination, not the current sprint.*

---

## 0. How to read this

This document describes where Runwisely is going. It is deliberately larger than what should be built next.

**The §0 rule from the master vision applies here too, doubly so:** every claim about what the product does must name the code that does it. This document contains a great deal of architecture that does not exist yet. Nothing in it should be quoted as a current capability, in marketing, in an ADR, or in another document, without checking the reconciliation in §3 first.

**Standing sequencing rule:** nothing in §5's later phases gets built before the validation gates in §4 pass. Architecture built ahead of demand is the most expensive kind of work there is.

---

## 1. The category

Runwisely is an **AI Company Operating System** — not AI-employee software, not workflow automation, not an agent marketplace, not an n8n alternative.

> Give Runwisely an idea or your existing business. It reverse-engineers the company, creates its structure and AI workforce, lets you connect your own capabilities, controls AI spending and permissions, coordinates the work, and keeps the company operating continuously.

**Two user types, always:** people with an idea, and people who already run a business. The system must never assume everyone starts from zero.

**The architectural rule that governs everything: company first, not agent first.** The company determines the workforce. Never force a business into a predefined agent catalogue.

## 2. The core abstraction

```
COMPANY → OBJECTIVES → STRUCTURE → DEPARTMENTS → ROLES →
RESPONSIBILITIES → TASKS → AGENTS → SKILLS → CAPABILITIES →
TOOLS/APIs/AI → AUTOMATION → COMPANY BRAIN → CONTINUOUS OPERATION
```

**Keep these concepts separate.** Agent = *who* performs. Skill = *what they know*. Capability = *what they can accomplish*. Tool/API = *how it executes*. Responsibility = *what they own*. Objective = *why the work exists*. Conflating them is how the architecture degrades into "a list of agents."

## 3. Reconciliation — what exists today

*Last reconciled 2026-09-03, against commit history through PR #213/#215/#217/#218/#219/#220/#221 (all merged).*

| Target capability | Real state |
|---|---|
| Idea → company reverse engineering | **Built, proven.** 7 templates + customize pass, domain-specific output, six-fixture suite. |
| Website → company analysis | **Built.** Shipped with SSRF validation and T2 content-as-data handling (ADR-058). |
| Existing-business audit (before/after mapping) | **Not built.** Website analysis produces a chart, not a current-state → future-state map. |
| Company Blueprint as a first-class object | **Framing built, structure unchanged.** `OrgChartScreen.tsx`/`CharterScreen.tsx` now present themselves as one "Company Blueprint" (Tier 1 item 2, PR #210) — presentation only, same underlying org chart + Charter data. Tech recommendations, automation opportunities as first-class fields still don't exist. |
| Company Graph | **Not built.** Relationships are implicit in a JSONB org chart, not a queryable graph. |
| Company Skill Tree | **Not built.** No skill layer exists — agents map straight to tasks. |
| Dynamic workforce generation | **Built.** Structure emerges from extracted tasks. |
| Agent / Skill / Capability / Tool separation | **Partial.** Agent, tool and task exist. Skill and capability do not. |
| Capability Registry | **Partial.** `tool-registry.md` is prose; Hands are scope-bound per sub-agent in code. No registry with schemas, costs, rate limits, or reliability data. |
| Model recommendation with reasoning | **Built for new extractions.** `recommendBrain()` (`packages/agents/extraction/src/recommendBrain.ts`) populates `Agent.brain` with a cost-grounded provider pick and a real, checkable reason — wired into `assembleOrgChart` (Tier 1 item 1, PR #210). **Not retroactive**: the 5 tenants whose org chart was captured before this shipped (including Acme) still show `brain: null` for every agent until their chart is regenerated — confirmed directly against Supabase, not assumed. |
| BYOK / BYOC | **Built for Brains.** Four providers validated, per-role keys, vault-encrypted. Hands are mostly OAuth-pending. |
| CEO / Company Brain | **Built, proven.** Real dispatch produced a genuine cross-team plan. T10 enforced structurally — recommend-only, no dispatch pathway. |
| Company Memory | **Not built.** Deliberately deferred: no adjacent design, real cross-run leakage implications. |
| Multi-agent orchestration with dynamic routing | **Partial.** Router tags, dedupes, dispatches. Routing is cadence-driven, not objective-driven. |
| Intelligent agent handoffs | **Foundation only.** `@byok/chains` shipped as a state machine (ADR-052), never wired into dispatch. |
| Structured agent outputs | **Partial.** Approval queue items are structured; inter-agent messages aren't. |
| Verification & error correction | **Partial.** Retries, circuit breakers, fail-closed gates, typed failures. No independent verification of agent output. |
| Risk-based autonomy | **Presentation layer built; earning mechanism unchanged.** `Agent.riskTier` (low/medium/high, derived from task stakes) now renders on `AgentsScreen`/`OrgChartScreen` (Tier 1 item 4, PR #210) — but the actual autonomy-*granting* logic underneath is still the same flat `locked`/`earnable`/`eligible-early` + permanent deny-list (`packages/approval-queue/src/denyList.ts`) it always was. `riskTier` is not read anywhere in the real gating path (`isDeniedFromAutonomy`) yet — naming this precisely so it isn't mistaken for the mechanism actually changing. |
| Agent Spend Protocol | **Built.** Per-company monthly (resetting correctly), per-agent daily from tier-derived budgets, **and now a real per-agent override surface** (Tier 1 item 3: `agent_budget_overrides` table + `/me/agent-budgets` route + `AgentsScreen.tsx` inline editor, PR #210) — an agent's ceiling can be authored by the founder, not just inherited from its tier, and `ceilingResolver` actually enforces it. Per-*task-type* limits (as opposed to per-agent) still don't exist. |
| Permission architecture | **Partial.** Tenant RLS, per-sub-agent tool scoping, step-up auth. No department/data/action permission layer. |
| Security & credential control | **Built.** Envelope encryption, AAD scope-binding, TTL-zeroing handles, revocation, per-tenant isolation. |
| Agent Activity Ledger | **Built.** Durable audit log, per-agent cost, dispatch records (`packages/db`'s shared `DurableAuditLog`, ADR-040). |
| Native automation engine | **Built at daily cadence — but was silently non-functional for the one real tenant for three weeks.** `perAgentDailyCeilingsFromOrgChart` (`apps/api/src/routes/ceiling.ts`) crashed on every single dispatch for Acme from at least 2026-08-19 to 2026-09-02 (`agent.budget` missing on Acme's stored chart, an unguarded access), and no `worker.on("failed", ...)` listener existed anywhere to surface it — confirmed by reading BullMQ's own failed-job data directly out of Redis, not inferred. Both are fixed and deployed live (PR #213, 2026-09-03T04:31 UTC): the ceiling function now falls back to the tier default instead of throwing, and both worker factories now log a failure's job name/id/tenant. Boot-verified clean, and the 30 stale failed Redis jobs the bug left behind (all pre-fix) were inspected and cleared. **Not yet directly observed: a real scheduled dispatch succeeding post-fix** — next natural firing 2026-09-03T18:31 UTC. "Built, proven, running unattended" (the phrasing in `runwisely-master-vision.md` §9) was false for three of the weeks it was in production, and should not be repeated again without watching the next real firing actually happen, not assuming it. |
| Continuous operating loop | **Partial, and see the row above.** Observe→execute→verify exist in code; whether "execute" was actually reaching real tenants went unverified for three weeks because nothing alerted on it. Learn captures deltas and surfaces patterns; nothing acts on them. |
| Event triggers | **Foundation only.** `@byok/webhooks` verifies signatures (ADR-054); nothing dispatches from a verified event. |
| Outcome learning | **Not built.** Template-learning patterns surface (ADR-049); no agent-performance or model-performance tracking. |
| Software development workforce | **Not built.** MVP-3 scope, explicitly gated. |
| Real execution (agents that act) | **Draft-only for everything except one task type — that one confirmed live, real inbox, 2026-09-03.** ADR-043's decision holds in general, but is superseded for `support.digest.weekly-summary` (SaaS template, PR #218): a real `ResendEffectExecutor` sends via the tenant's own connected Resend key, gated on a human APPROVE/MODIFY — earned autonomy cannot bypass this for any effect-bearing action, by construction (`queue.ts`). Backfilled into Acme with explicit real-tenant authorization; the founder connected Resend, approved the proposed send through the real Approvals UI, and confirmed the email arrived. Proof of the mechanism for one task type, not a general capability — every other task type across every template stays draft-only, and this one doesn't exist on any other real tenant's chart yet. Two further silent-failure-class gaps found and closed in the process: `AgentsScreen.tsx` crashed for every real tenant on `objective`/`reportingStructure` (PR #219, the other half of PR #215's fix); the API/UI never surfaced whether a dispatched effect actually succeeded (PR #221). |

**The honest summary:** the control plane is genuinely strong — spend, security, audit, isolation — but one link in that chain (the scheduler actually *running*, not just being architecturally sound) was broken and invisible for three weeks against the only real tenant this system has. That's now fixed and independently verified, not just patched and assumed. The *intelligence* layer described in §2 is still largely absent: no graph, no skills, no memory, no objective-driven routing, no verification of output, no outcome learning. Tier 1 (§5) closed the four items it named; nothing in Tier 2 has started, correctly, per §4's own gate.

## 4. Validation gates — these come before more architecture

Nothing in §5's Tier 2 or 3 gets built until these pass. They cost days, not months, and every one of them can invalidate architecture built ahead of it.

1. **Twenty testers.** ≥70% saying the org chart taught them something about their business. Ready for weeks. **Still open** — needs real signup volume, not more engineering.
2. **Key-connection rate.** ≥35% of chart-completers connect a Brain key. **Still open** — same, needs volume.
3. **Billing proven end to end** in test mode against real staging. **Done** — real Checkout Session → subscription → webhook → tier/Stripe-id update → cancellation → tier revert, all verified against live Stripe test mode and a real database row read (2026-09-01/02).
4. **Google OAuth verification submitted** — the shortest path from "we draft" to "we act," which is the category's own dividing line. **Still open** — this is a real action item (submit the verification request), not a build task.
5. **First paying customer.** **Still open.**

## 5. Sequenced roadmap

### Tier 1 — buildable now, user-visible, ungated — **done** (PR #210, 2026-09-02)
- Model recommendation with reasoning (`Agent.brain` populated, with the *why*) — **built**, new extractions only (see §3's own caveat on the 5 pre-existing stored charts).
- Company Blueprint framing over data that already exists — **built**.
- Editable per-agent budgets, and the missing product surface for per-role/per-task ceilings — **built** for per-agent; per-task-type still doesn't exist.
- Risk-tiering autonomy as low/medium/high rather than a flat earned/denied split — **built as a presentation layer** (`Agent.riskTier`); the underlying earning/denial mechanism is unchanged — see §3.

**Nothing in Tier 2 starts yet.** §4's gates haven't cleared (2 of 5 done). The scheduler incident (§3) delayed nothing here — it was found and fixed alongside verifying the Tier 1 work's own database migration, not instead of it.

### Tier 2 — after the validation gates
- **Company Graph** — the foundational shift from JSONB blob to queryable relationships. Everything in Tier 3 depends on it.
- **Skill layer** — the missing rung between role and capability; prerequisite for the Skill Tree.
- **Capability Registry** — schemas, costs, rate limits, reliability, auth requirements as data rather than prose.
- Wire `@byok/chains` and `@byok/webhooks` into real dispatch.
- Existing-business before/after transformation mapping.

### Tier 3 — after paying customers
- **Company Memory** — structured, scoped, with cross-run leakage controls. A project, not a field.
- **Objective-driven orchestration** — the CEO coordinating agents around company goals rather than cadences.
- **Verification & error-correction engine** — independent checking of high-risk output.
- **Outcome learning** — agent success rates, model performance, capability reliability feeding routing.
- Model routing with fallback across providers.

### Tier 4 — the demonstration
- Software development workforce (MVP-3): product, UX, engineering, QA, security, DevOps agents building and deploying real products under human approval for production actions.

## 6. What the moat actually is

Not "we have AI agents." Not wrapping LLMs. The moat is the **combination**: company understanding, the graph, memory, dynamic workforce generation, handoff intelligence, capability routing, model routing, verification, error correction, permissions, spend control, security, audit, continuous execution, and outcome learning.

**Today, the defensible parts that genuinely exist are:** reverse engineering that produces domain-specific structure, per-tenant spend control that fails closed, credential isolation, and a proven continuous scheduler. That's a real foundation. It is not yet the full moat, and the documents should not claim otherwise.

## 7. Governing principles

**Hide complexity, not capability.** A non-technical user sees company, CEO, departments, agents, automation, spending, approvals. They never see nodes, webhooks, prompts, or infrastructure. Advanced users can inspect everything underneath.

**Don't build framework for its own sake.** Every component must solve a real problem. "Proprietary orchestration" is not a reason to build something.

**Measure the right things.** Not agent count or integration count. Company-understanding accuracy, time for a non-technical user to create a company, usefulness of the generated structure, how much complexity is hidden, how much useful work agents do, how safely they operate, how well spend is controlled, how continuously the company runs, and how much manual work disappears.

**Be honest about AI reliability.** Runwisely reduces the probability and impact of AI errors. It does not eliminate hallucination, and must never claim to.

## 8. The promise

> You bring the idea or the business. Runwisely understands the company, builds the structure, and orchestrates the capabilities you connect. Your AI workforce operates the company — under your spending limits, your permissions, and your approval.

The ambition is a company operating system used globally by founders and small businesses. That ambition is supported by building technology and distribution capable of reaching it — not by claiming traction that doesn't exist.
