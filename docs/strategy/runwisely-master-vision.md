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
| Company Blueprint before activation | **Framing built** (Tier 1 item 2, PR #210, 2026-09-02) — `OrgChartScreen.tsx`/`CharterScreen.tsx` present as one "Company Blueprint" pre-activation. Architecture recommendations as a distinct field still don't exist. |
| Per-role AI model recommendation | **Built for new extractions** (Tier 1 item 1, PR #210) — `recommendBrain()` (`packages/agents/extraction/src/recommendBrain.ts`) populates `Agent.brain` with a cost-grounded provider pick and a real, checkable reason. **Not retroactive**: 5 tenants' stored charts (captured before this shipped, including Acme's) still show `brain: null` until regenerated — see `runwisely-north-star.md` §3. |
| User-owned capabilities | **Partially.** Hands are scope-bound per sub-agent with JIT granting. Most are OAuth-only and unbuilt; Google Calendar is the only real OAuth flow and it's inert pending verification. |
| Agent Spend Protocol | **Built, including the per-agent override surface.** Per-tenant durable ceilings, fail-closed gate, pause-and-resume, real cost per sub-agent, both "monthly" and "per-day" resetting correctly (`companyScopeKey`, `packages/cost-gate/src/durable/reservationStore.ts`). Tier 1 item 3 (PR #210, 2026-09-02) added the missing product surface: `agent_budget_overrides` table + `/me/agent-budgets` route + an inline editor on `AgentsScreen.tsx` — a founder can now actually set a per-agent ceiling, and `ceilingResolver` enforces it, not just displays it. **Real incident along the way, now fixed (PR #213):** the fallback this same route needs when an agent's stored `budget` predates the field entirely crashed 100% of Acme's scheduled dispatch for three weeks before anyone noticed — see `runwisely-north-star.md` §3 for the full account. `perRoleUsd`/`perTaskTypeUsd` (the two non-day, non-company, non-per-agent levels) remain wired to `{}` in both trust cores — still not built. |
| Native automation, no visible nodes | **Built at daily cadence — correction, 2026-09-02: this line previously read "proven running unattended," which was false for three of the weeks it was live.** Acme's scheduled dispatch crashed on every single firing from at least 2026-08-19 to 2026-09-02 (a JSONB schema-drift bug in `ceiling.ts`, compounded by zero failure logging anywhere in `packages/jobs`) — found and fixed while verifying an unrelated database migration, not by any alert. Fixed and deployed live 2026-09-03T04:31 UTC (PR #213), boot-verified clean. **Correction, 2026-09-03: this row previously also claimed "a real cadence tick and a real manual dispatch both landed correctly post-fix" — that observation had not actually happened yet when it was written.** Not yet directly observed as of this snapshot; next natural firing 2026-09-03T18:31 UTC. Recorded here, not just silently corrected, because this exact document is the one that made both claims — see `runwisely-north-star.md` §3 and ADR-059 for the full incident. |
| CEO / Company Brain | **Built and proven.** Real dispatch produced a genuine cross-team plan. T10 enforced structurally: recommend-only, no dispatch pathway. |
| Continuous 24/7 operation | **Built, at daily cadence — same correction as the row above applies here.** Cost-gated, with earned autonomy. Fixed and deployed; not yet directly re-observed dispatching (see the row above) — architecturally capable of it, pending that observation. |
| Agents produce results | **Draft-only, except one narrow proof — confirmed live, 2026-09-03.** `support.digest.weekly-summary` (SaaS template, PR #218) sends a real email via the tenant's own Resend key, human-gated, earned autonomy unable to bypass it. Backfilled into Acme, connected, approved, and the email confirmed received — not just built and tested in code. Everything else stays draft-only — deliberate (ADR-043), and still the market's own dividing line in general. |
| Continuous OBSERVE→…→LEARN loop | **Partial, closer than before.** Observe/think/plan/delegate/execute/verify exist. Learn: deltas are captured (migration `0016`) *and now aggregated* — `TemplateTaskDeltaStore.aggregatedPatterns` and the token-gated `/internal/template-learning` route surface structural, threshold-gated patterns (≥5 distinct users, `detail.text` never included — see §10). What's still missing is the step after that: nothing turns a surfaced pattern into an actual, human-reviewed change to a template file. |
## 10. The four real gaps
**1. Execution.** The market judges on whether a product *acts* or only *drafts*, and Runwisely mostly drafts still — one task type (§9's "Agents produce results" row, PR #218) is a real, human-gated exception, not a general capability. Google Calendar OAuth verification is the shortest path to "and it acts" more broadly.
**2. Learning.** Narrower now: capture and aggregation both shipped (structural patterns only, ≥5-distinct-user threshold, no free text ever surfaced — the redaction question turned out to be a `HAVING` clause, not a PII scrubber, once framed around cross-tenant leakage rather than PII). What's still missing is the last, genuinely unscoped step: turning a surfaced pattern into an actual, human-reviewed template change. That's a workflow question (who reviews, what the review surface is, how a change ships) nobody has designed yet.
**3. Per-agent budgets.** Narrower still: every agent now has a real `budget` field and a real per-day ceiling keyed to its own id, not a shared flat number. What's left is that the *value* is a tier-default (T1/T2/T3), not an informed per-agent number — nothing has ever measured what a specific agent actually costs — and there's no product surface to override one even if a better number existed. The dashboard now shows this (read-only); editing it needs its own persistence design.
**4. Validation.** Nobody outside the build has used it. No pilot, no signups, no pricing tested against a buyer. This is the largest gap and the only one that can't be closed by engineering.
---
## 11. Commercial model
**One plan, one company per user.** Everything included — unlimited agents, all AI providers, all Hands, full approval and spending controls.
| | Total | Effective | Save |
|---|---|---|---|
| Monthly | $39.99 | $39.99/mo | — |
| Quarterly | $107.97 | $35.99/mo | 10% |
| Yearly | $383.90 | $31.99/mo | 20% |
**Target infrastructure cost: ≤$6 per company per month.** Not a proven figure — modelled at $3.59–$9.39 and to be validated against real instrumentation data. Never present it as proven.
**The paywall sits at activation, not understanding.** A user sees their reverse-engineered company — structure, departments, roles, agents, automation opportunities — free. They pay to *operate* it. The intended reaction: *"Runwisely understands the company I need. Now I want it to actually run."*
---
## 12. Phased plan
**Phase A — Close the credibility gaps (now)**
1. ~~Website-as-input, with SSRF validation as a hard prerequisite, T2 content-as-data handling, and its own cost gate ahead of the extraction batch.~~ **Done** — [PR #202](https://github.com/veltrixnextgen-arch/byok-business-autopilot/pull/202) (ADR-058).
2. ~~Per-agent and per-day spend limits, to make the Spend Protocol match its description.~~ **Done** — `Agent.budget` (tier-derived), real per-agent daily ceilings wired into both trust cores, read-only visibility in `AgentsScreen.tsx`. [PR #205](https://github.com/veltrixnextgen-arch/byok-business-autopilot/pull/205). Still open, and deliberately not this PR: an *informed* (not tier-default) per-agent value, and a surface to edit one.
3. Measured hourly-cadence COGS against real instrumentation, deciding whether continuous operation can be faster than daily at $39.99.
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
