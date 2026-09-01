# Runwisely — Master Vision, Reconciled
**The product philosophy, mapped against what is actually built, with an honest gap analysis and the phased plan to close it.**
*August 2026 — supersedes the pricing sections of master-plan-v2 and the phase ordering of the automation runtime plan.*
---
## 0. How to read this document
The vision statement (§1–§8) is the product's north star and should be treated as durable. Everything after §9 is a reconciliation: what exists, what doesn't, and what order to build it in. The reconciliation is the part that goes stale — regenerate it against repo state rather than trusting it months from now.
**A standing rule this document exists to enforce:** every claim about what the product does must name the code that does it. Two ADRs in this project have asserted product behavior that no code implemented (ADR-051's "capped at 10 companies", and earlier "believed shipped" issue statuses). Vision documents are the most likely place for that to recur.
---
## 1. What Runwisely is
An **AI-powered operating system for businesses and founders** — not an AI employee platform, not a chatbot, not a workflow builder.
The problem: millions of people have ideas, expertise, or small businesses, and no idea how a company should be structured, what roles it needs, what work must happen, or how to automate any of it.
The user should never need to learn APIs, workflow builders, nodes, triggers, webhooks, databases, infrastructure, agent frameworks, or AI orchestration. They describe what they want to build. Runwisely reverse-engineers the business, creates the structure, creates the agents, recommends capabilities, and creates the automation.
**The user should feel like they are creating a company, not building a workflow.**
## 2. The core flow
```
IDEA or EXISTING BUSINESS
  → REVERSE ENGINEER
  → COMPANY BLUEPRINT
  → DEPARTMENTS → ROLES → AI AGENTS
  → CAPABILITIES / TOOLS / APIs
  → AUTOMATION
  → CEO / COMPANY BRAIN
  → 24/7 OPERATION
  → RESULTS
```
Always reason from the business outcome backwards, never from available tools forwards. Not *"which automation should we build?"* but *"what does this company need to accomplish → what work is required → who owns it → what capabilities does that role need → what should happen automatically?"*
## 3. Reverse engineering is the heart
From an idea, Runwisely determines: business objective, customer, value proposition, business model, company structure, roles, responsibilities, continuous tasks, required systems, automation opportunities, human-approval points, per-role AI capability, and per-agent budget.
**The structure must emerge from the business.** A software company, a restaurant, a construction firm, a consultancy, and a creator business must not produce the same org chart. The platform never determines the workforce — the company does.
## 4. Two ways in
**Describe your idea** — plain language, reverse-engineered from scratch.
**Add your website** — paste a URL; Runwisely analyses what the company sells, its customers, products, business model, customer journey, existing functions, and missing ones, then produces a blueprint from the real business.
**Both together** — a founder with an existing site who wants Runwisely to understand and automate it.
## 5. Company Blueprint
Shown *before* activation: company identity and objectives, dynamically generated departments, roles, responsibilities, automation opportunities, capability requirements, and (where relevant) recommended architecture.
## 6. Roles become agents
Each agent carries: role, objective, responsibilities, tasks, required capabilities, tools, AI model, permissions, budget, approval requirements, reporting structure, escalation rules. Never create unnecessary agents.
*(Memory deliberately isn't on this list — see §9/§10. It has no adjacent design anywhere in this codebase and real T2 implications for one run's content leaking into a later one; it's a future scoping decision, not a property every agent is assumed to carry today.)*
## 7. User-owned capabilities, user-owned intelligence
Runwisely is the operating layer that decides **which role needs which capability**. The user connects their own AI models, APIs, SaaS tools, CRM, payments, dev tools — and pays for them directly.
Model choice is per-role and recommended, not assumed: strong reasoning for the CEO, coding-optimised for developers, fast and cheap for support, appropriate writing models for content. The system explains *why* a model fits a role.
## 8. Agent Spend Protocol
Per-task, per-day, per-month, and company-wide limits. On reaching a limit: **stop**, request approval, never continue spending. The CEO sees agent spend, tool spend, AI spend, remaining budget, projected spend, violations, and approval requests.
**Controlled autonomy** — let AI work continuously without letting spending become uncontrollable.
---
## 9. Reconciliation: what is actually built
| Vision element | Real state |
|---|---|
| Reverse engineering from an idea | **Built and proven.** 7 templates + customize pass; produces genuinely domain-specific output (BC food-safety, BCFSA/FINTRAC, state licensing). Six-fixture differentiation suite passing. |
| Dynamic structure, not fixed | **Built.** Clusters emerge from extracted tasks; different business types produce structurally different charts. |
| Roles → agents with full metadata | **Mostly built.** The real `Agent` type (`packages/agents/contracts/src/orgChart.ts`) now carries id, name, title, **objective** (derived from the agent's own task text, not authored or LLM-generated), teamId, taskIds, tier, brain (nullable), hands (tool names), **budget** (tier-derived default — see the Spend Protocol row below), **reportingStructure** (`{teamId, teamRoleTitle}`), autonomyDefault, complianceLocked, requiresProfessionalVerification — task-level cadence lives on `Task`, not `Agent`. **Still absent, deliberately: `memory`** (no adjacent design anywhere in this codebase, real T2 implications, scoped out rather than added because the vision named it — see §10) **and explicit escalation rules** (not scoped in this pass). |
| Website as input | **Built.** SSRF-safe fetch with per-redirect-hop re-validation (`packages/agents/extraction/src/websiteFetch.ts`), T2-framed summarization (`websiteSummary.ts`), its own pre-extraction CostGate reservation (`apps/api/src/extraction/runWebsiteSummary.ts`), and a UI mode toggle that falls back to free text on any non-success status (`apps/web/src/components/landing/IdeaForm.tsx`). Shipped in [PR #202](https://github.com/veltrixnextgen-arch/byok-business-autopilot/pull/202) (ADR-058). |
| Company Blueprint before activation | **Partially.** Org chart + Charter exist and are shown pre-activation; "blueprint" framing and architecture recommendations don't. |
| Per-role AI model recommendation | **Half built.** Vault, router, CostGate and scheduler are all provider-aware; tier varies per role. The *recommendation with reasoning* is a markdown doc no code reads. |
| User-owned capabilities | **Partially.** Hands are scope-bound per sub-agent with JIT granting. Most are OAuth-only and unbuilt; Google Calendar is the only real OAuth flow and it's inert pending verification. |
| Agent Spend Protocol | **Built, and both "monthly" and "per-day" now genuinely reset.** Per-tenant durable ceilings, fail-closed gate, pause-and-resume, real cost per sub-agent. The company-level ceiling's scope_key now folds in the UTC calendar month (`companyScopeKey`, `packages/cost-gate/src/durable/reservationStore.ts`) — it used to be the literal string `"company"`, one counter per tenant accumulating since their first-ever spend, so a tenant who crossed it once stayed blocked forever; a new month is now just a row nothing's written to yet, same free-reset mechanic as the day-level ceiling. The `"task-type-day"` level (migration `0020`) resets daily, and `CeilingConfig.perTaskTypePerDayUsd` (migration `0021`'s trust-core wiring) is a real per-agent map — both trust cores read the tenant's own org chart and populate it from each agent's own `budget.perDayUsd`, falling back to the flat `DEFAULT_PER_AGENT_PER_DAY_USD` only for onboarding-time task types with no agent to draw from. The per-agent values themselves are still tier-derived defaults, not informed per-agent numbers — a T1 agent's cap differs from a T3 agent's, but two T1 agents share the same number. **Still missing:** any product surface to *set* a per-agent override (read-only visibility shipped in `AgentsScreen.tsx`), and `perRoleUsd`/`perTaskTypeUsd` (the two non-day, non-company levels) remain wired to `{}` in both trust cores. |
| Native automation, no visible nodes | **Built.** Scheduler dispatches on cadence with no workflow UI. Proven running unattended. |
| CEO / Company Brain | **Built and proven.** Real dispatch produced a genuine cross-team plan. T10 enforced structurally: recommend-only, no dispatch pathway. |
| Continuous 24/7 operation | **Built, at daily cadence.** Runs unattended, cost-gated, with earned autonomy. |
| Agents produce results | **Draft-only.** Nothing sends, posts, or pays. Deliberate (ADR-043), and the market's own dividing line. |
| Continuous OBSERVE→…→LEARN loop | **Partial, closer than before.** Observe/think/plan/delegate/execute/verify exist. Learn: deltas are captured (migration `0016`) *and now aggregated* — `TemplateTaskDeltaStore.aggregatedPatterns` and the token-gated `/internal/template-learning` route surface structural, threshold-gated patterns (≥5 distinct users, `detail.text` never included — see §10). What's still missing is the step after that: nothing turns a surfaced pattern into an actual, human-reviewed change to a template file. |
## 10. The four real gaps
**1. Execution.** The market judges on whether a product *acts* or only *drafts*, and Runwisely drafts. Google Calendar OAuth verification is the shortest path to "and it acts."
**2. Learning.** Narrower now: capture and aggregation both shipped (structural patterns only, ≥5-distinct-user threshold, no free text ever surfaced — the redaction question turned out to be a `HAVING` clause, not a PII scrubber, once framed around cross-tenant leakage rather than PII). What's still missing is the last, genuinely unscoped step: turning a surfaced pattern into an actual, human-reviewed template change. That's a workflow question (who reviews, what the review surface is, how a change ships) nobody has designed yet.
**3. Per-agent budgets.** Narrower still: every agent now has a real `budget` field and a real per-day ceiling keyed to its own id, not a shared flat number. What's left is that the *value* is a tier-default (T1/T2/T3), not an informed per-agent number — nothing has ever measured what a specific agent actually costs — and there's no product surface to override one even if a better number existed. The dashboard now shows this (read-only); editing it needs its own persistence design.
**4. Validation.** Nobody outside the build has used it. No pilot, no signups, no pricing tested against a buyer. This is the largest gap and the only one that can't be closed by engineering.
---
## 11. Commercial model
**One plan, one company per user.** Everything included — unlimited agents, all AI providers, all Hands, full approval and spending controls.
| | Total | Effective | Save |
|---|---|---|---|
| Monthly | $39 | $39/mo | — |
| Quarterly | $105 | $35/mo | 10% |
| Yearly | $374 | $31.17/mo | 20% |
**Target infrastructure cost: ≤$6 per company per month.** Not a proven figure — modelled at $3.59–$9.39 and to be validated against real instrumentation data. Never present it as proven.
**The paywall sits at activation, not understanding.** A user sees their reverse-engineered company — structure, departments, roles, agents, automation opportunities — free. They pay to *operate* it. The intended reaction: *"Runwisely understands the company I need. Now I want it to actually run."*
---
## 12. Phased plan
**Phase A — Close the credibility gaps (now)**
1. ~~Website-as-input, with SSRF validation as a hard prerequisite, T2 content-as-data handling, and its own cost gate ahead of the extraction batch.~~ **Done** — [PR #202](https://github.com/veltrixnextgen-arch/byok-business-autopilot/pull/202) (ADR-058).
2. ~~Per-agent and per-day spend limits, to make the Spend Protocol match its description.~~ **Done** — `Agent.budget` (tier-derived), real per-agent daily ceilings wired into both trust cores, read-only visibility in `AgentsScreen.tsx`. [PR #205](https://github.com/veltrixnextgen-arch/byok-business-autopilot/pull/205). Still open, and deliberately not this PR: an *informed* (not tier-default) per-agent value, and a surface to edit one.
3. Measured hourly-cadence COGS against real instrumentation, deciding whether continuous operation can be faster than daily at $39.
4. Google OAuth verification submitted — the shortest route to real execution.
**Phase B — Validation (should not wait for Phase A)**
5. The twenty-tester pilot. ≥70% saying the chart taught them something; ≥35% connecting a key. Ready for weeks.
6. Stripe Checkout proven end to end, then live-mode mirroring.
**Phase C — Close the loop**
7. ~~Learning: aggregation and redaction over captured deltas~~, **then human-reviewed template proposals.** Aggregation/redaction done — structural-only patterns, ≥5-distinct-user threshold, `/internal/template-learning` ([PR #205](https://github.com/veltrixnextgen-arch/byok-business-autopilot/pull/205)). Human-reviewed proposals (turning a surfaced pattern into an actual template change) remains fully open — a separate workflow question, not scoped by this pass.
8. Blueprint framing — present the org chart as a Company Blueprint including automation opportunities and, where relevant, architecture recommendations.
9. R5 task chains and R6 event triggers wired into dispatch (both shipped as foundations, neither consumed yet).
**Phase D — Execution**
10. First real effect dispatch, human-gated, once at least one Hands connection is production-usable.
11. Then, and only then, earned-autonomy execution — the first genuinely unattended external action.
**Phase E — The larger vision**
12. Multi-company support (agencies), the deploy layer (MVP-3), and the developer-agent loop described in §14 of the source vision — all gated on paying users, not on ambition.
---
## 13. The golden rule
For every feature, workflow, agent, and screen: **does this make running a company easier for a non-technical person?** If it adds technical complexity without business value, hide it behind the system.
The user should never feel *"I need to learn automation."* They should feel *"I told Runwisely what I want to build, and it figured out how the company needs to work."*
**Do not build a tool that teaches people how to automate. Build the system that makes automation unnecessary to understand.**
