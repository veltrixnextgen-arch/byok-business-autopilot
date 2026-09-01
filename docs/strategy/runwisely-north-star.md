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

| Target capability | Real state |
|---|---|
| Idea → company reverse engineering | **Built, proven.** 7 templates + customize pass, domain-specific output, six-fixture suite. |
| Website → company analysis | **Built.** Shipped with SSRF validation and T2 content-as-data handling. |
| Existing-business audit (before/after mapping) | **Not built.** Website analysis produces a chart, not a current-state → future-state map. |
| Company Blueprint as a first-class object | **Partial.** Org chart + Charter exist; blueprint framing, tech recommendations, automation opportunities don't. |
| Company Graph | **Not built.** Relationships are implicit in a JSONB org chart, not a queryable graph. |
| Company Skill Tree | **Not built.** No skill layer exists — agents map straight to tasks. |
| Dynamic workforce generation | **Built.** Structure emerges from extracted tasks. |
| Agent / Skill / Capability / Tool separation | **Partial.** Agent, tool and task exist. Skill and capability do not. |
| Capability Registry | **Partial.** `tool-registry.md` is prose; Hands are scope-bound per sub-agent in code. No registry with schemas, costs, rate limits, or reliability data. |
| Model recommendation with reasoning | **Not built.** `Agent.brain` is null for every agent. Tier varies per role; provider is stored and dispatched but never recommended. |
| BYOK / BYOC | **Built for Brains.** Four providers validated, per-role keys, vault-encrypted. Hands are mostly OAuth-pending. |
| CEO / Company Brain | **Built, proven.** Real dispatch produced a genuine cross-team plan. T10 enforced structurally — recommend-only, no dispatch pathway. |
| Company Memory | **Not built.** Deliberately deferred: no adjacent design, real cross-run leakage implications. |
| Multi-agent orchestration with dynamic routing | **Partial.** Router tags, dedupes, dispatches. Routing is cadence-driven, not objective-driven. |
| Intelligent agent handoffs | **Foundation only.** `@byok/chains` shipped as a state machine, never wired into dispatch. |
| Structured agent outputs | **Partial.** Approval queue items are structured; inter-agent messages aren't. |
| Verification & error correction | **Partial.** Retries, circuit breakers, fail-closed gates, typed failures. No independent verification of agent output. |
| Risk-based autonomy | **Partial.** Earned autonomy per task type with a permanent deny-list. Not risk-tiered as low/medium/high. |
| Agent Spend Protocol | **Mostly built.** Per-company monthly (now resetting correctly), per-agent daily from tier-derived budgets. Per-task limits and user-editable per-agent values missing. |
| Permission architecture | **Partial.** Tenant RLS, per-sub-agent tool scoping, step-up auth. No department/data/action permission layer. |
| Security & credential control | **Built.** Envelope encryption, AAD scope-binding, TTL-zeroing handles, revocation, per-tenant isolation. |
| Agent Activity Ledger | **Built.** Durable audit log, per-agent cost, dispatch records. |
| Native automation engine | **Built, daily cadence.** Scheduler dispatches with no workflow UI. |
| Continuous operating loop | **Partial.** Observe→execute→verify exist. Learn captures deltas and surfaces patterns; nothing acts on them. |
| Event triggers | **Foundation only.** `@byok/webhooks` verifies signatures; nothing dispatches from a verified event. |
| Outcome learning | **Not built.** Template-learning patterns surface; no agent-performance or model-performance tracking. |
| Software development workforce | **Not built.** MVP-3 scope, explicitly gated. |
| Real execution (agents that act) | **Draft-only, deliberate.** ADR-043. Nothing sends, posts, or pays. |

**The honest summary:** the control plane is genuinely strong — spend, security, audit, approval, isolation. The *intelligence* layer described in §2 is largely absent: no graph, no skills, no memory, no objective-driven routing, no verification of output, no outcome learning.

## 4. Validation gates — these come before more architecture

Nothing in §5's Tier 2 or 3 gets built until these pass. They cost days, not months, and every one of them can invalidate architecture built ahead of it.

1. **Twenty testers.** ≥70% saying the org chart taught them something about their business. Ready for weeks.
2. **Key-connection rate.** ≥35% of chart-completers connect a Brain key.
3. **Billing proven end to end** in test mode against real staging.
4. **Google OAuth verification submitted** — the shortest path from "we draft" to "we act," which is the category's own dividing line.
5. **First paying customer.**

## 5. Sequenced roadmap

### Tier 1 — buildable now, user-visible, ungated
- Model recommendation with reasoning (`Agent.brain` populated, with the *why*)
- Company Blueprint framing over data that already exists
- Editable per-agent budgets, and the missing product surface for per-role/per-task ceilings
- Risk-tiering autonomy as low/medium/high rather than a flat earned/denied split

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
